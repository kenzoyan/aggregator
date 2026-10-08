import Decimal from "decimal.js";

import { cashDestinationSchema } from "@/application/portfolio-cash-contract";
import type { EditableDraftPortfolio } from "@/application/imports/import-draft-read-model";
import type { ImportReconciliation } from "@/domain/imports";
import { openingPositionFromPortfolioState } from "@/domain/import-snapshot";
import { identitiesOverlap, normalizedIdentityKeys } from "@/domain/portfolio/identity";
import type { OpeningSnapshotInput, PortfolioState, SaleEventInput } from "@/domain/portfolio/types";

export class ImportReductionError extends Error {}

export function findImportReductions(portfolio: EditableDraftPortfolio, reconciliation?: ImportReconciliation) {
  return (reconciliation?.holdings ?? []).flatMap((holding) => {
    if (!holding.before) return [];
    const before = holding.before;
    const after = portfolio.holdings.find((candidate) => identitiesOverlap(
      normalizedIdentityKeys([candidate.instrumentId, candidate.instrumentCode]),
      normalizedIdentityKeys([before.instrumentId, before.instrumentCode])));
    if (!after && reconciliation?.mode !== "complete") return [];
    try {
      const quantity = new Decimal(before.quantity).minus(after?.quantity ?? "0");
      if (!quantity.isFinite() || quantity.lte(0)) return [];
      return [{ instrumentId: before.instrumentId, name: before.displayName ?? before.instrumentId, currency: before.currency, quantity: quantity.toString() }];
    } catch { return []; }
  });
}

export function resolveImportReductions(input: {
  portfolio: EditableDraftPortfolio;
  reconciliation: ImportReconciliation;
  snapshot: OpeningSnapshotInput;
  currentState: PortfolioState;
  sourceImportId: string;
  recordedAt: string;
}) {
  const candidates = findImportReductions(input.portfolio, input.reconciliation);
  const reviews = input.portfolio.reductionReviews ?? [];
  if (new Set(reviews.map((review) => review.instrumentId)).size !== reviews.length) throw new ImportReductionError("Review each reduced holding once.");
  const events: SaleEventInput[] = [];
  let snapshot = input.snapshot;
  for (const candidate of candidates) {
    const review = reviews.find((item) => item.instrumentId === candidate.instrumentId);
    if (!review || review.quantity !== candidate.quantity) {
      throw new ImportReductionError(`Review the ${candidate.quantity} unit reduction in ${candidate.name}. Enter sale proceeds and their destination, or mark it as a quantity correction.`);
    }
    if (review.kind === "adjustment") {
      if (!review.reason.trim()) throw new ImportReductionError(`Enter a reason for the quantity correction in ${candidate.name}.`);
      continue;
    }
    if (!/^\d+(?:\.\d+)?$/.test(review.proceeds) || !/^\d+(?:\.\d+)?$/.test(review.fees)) throw new ImportReductionError("Enter sale proceeds and fees as non-negative decimal amounts.");
    const proceeds = new Decimal(review.proceeds);
    const fees = new Decimal(review.fees);
    if (proceeds.lte(0) || fees.gt(proceeds)) throw new ImportReductionError("Sale proceeds must be above zero and fees cannot exceed proceeds.");
    const parsedDestination = cashDestinationSchema.safeParse(review.destination);
    if (!parsedDestination.success) throw new ImportReductionError("Enter the receiving account name for external sale proceeds.");
    const destination = parsedDestination.data;
    const after = snapshot.positions.find((position) => position.instrumentId === candidate.instrumentId);
    if (after && after.currency !== candidate.currency) throw new ImportReductionError("Resolve the holding's currency change before recording this sale.");
    const positionBefore = input.currentState.positions.find((position) => position.sourceAccountId === snapshot.sourceAccountId && position.instrumentId === candidate.instrumentId)!;
    events.push({ id: `import-sale:${input.sourceImportId}:${events.length + 1}`, type: "sale", sourceAccountId: snapshot.sourceAccountId,
      instrumentId: candidate.instrumentId, quantity: candidate.quantity, asOf: snapshot.asOf,
      proceeds: { amount: proceeds.toString(), currency: candidate.currency }, fees: { amount: fees.toString(), currency: candidate.currency },
      importUndo: { snapshotId: snapshot.id, positionBefore: openingPositionFromPortfolioState(positionBefore),
        retainedCash: { amount: destination.kind === "investment-account" ? proceeds.minus(fees).toString() : "0", currency: candidate.currency } },
      destination, sourceImportId: input.sourceImportId, recordedAt: input.recordedAt,
    });
    // Imported cash is authoritative. Only add retained proceeds when the source omitted cash.
    if (!input.portfolio.portfolioCash && destination.kind === "investment-account") {
      const currency = snapshot.portfolioCash?.currency ?? candidate.currency;
      if (currency !== candidate.currency) throw new ImportReductionError("Review cash in the sale currency before confirming this import.");
      snapshot = { ...snapshot, portfolioCash: { currency, amount: new Decimal(snapshot.portfolioCash?.amount ?? "0").plus(proceeds).minus(fees).toString() } };
    }
  }
  return { snapshot, events };
}
