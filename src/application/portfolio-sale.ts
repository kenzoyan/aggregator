import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import { z } from "zod";

import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type {
  OpeningSnapshotInput, PortfolioEventInput, PortfolioState,
} from "@/domain/portfolio/types";

const decimal = z.string().trim().regex(/^\d+(?:\.\d+)?$/, "Enter a non-negative decimal amount.");
export const saleInputSchema = z.object({
  sourceAccountId: z.string().min(1),
  instrumentId: z.string().min(1),
  date: z.iso.date(),
  quantity: decimal,
  proceeds: decimal,
  fees: decimal,
}).strict();
export type SaleInput = z.infer<typeof saleInputSchema>;

export class SaleReviewError extends Error {
  constructor(message: string) { super(message); }
}

interface SaleFacts {
  openingSnapshots: OpeningSnapshotInput[];
  events: PortfolioEventInput[];
  state: PortfolioState;
}

export function prepareSaleReview(facts: SaleFacts, input: SaleInput) {
  const current = facts.state.positions.find((position) =>
    position.sourceAccountId === input.sourceAccountId && position.instrumentId === input.instrumentId);
  if (!current) throw new SaleReviewError("This holding is no longer available.");
  const latestSnapshot = facts.openingSnapshots
    .filter((snapshot) => snapshot.sourceAccountId === input.sourceAccountId)
    .toSorted((a, b) => b.asOf.localeCompare(a.asOf))[0];
  const now = new Date();
  const asOf = input.date === portfolioCalendarDate(now)
    ? now.toISOString()
    : `${input.date}T23:59:59.999Z`;
  if (!latestSnapshot || asOf <= latestSnapshot.asOf) {
    throw new SaleReviewError("Choose a date after the latest confirmed holding snapshot.");
  }
  if (input.date > portfolioCalendarDate(now)) {
    throw new SaleReviewError("A sale date cannot be in the future.");
  }
  const latestEvent = facts.events
    .filter((event) => event.sourceAccountId === input.sourceAccountId)
    .at(-1);
  if (latestEvent && asOf < latestEvent.asOf) {
    throw new SaleReviewError("Choose a date on or after this account's latest saved event.");
  }
  const quantity = new Decimal(input.quantity);
  const proceeds = new Decimal(input.proceeds);
  const fees = new Decimal(input.fees);
  if (quantity.lte(0) || quantity.gt(current.quantity)) {
    throw new SaleReviewError("Sale quantity must be above zero and no more than the current quantity.");
  }
  if (proceeds.lte(0) || fees.lt(0) || fees.gt(proceeds)) {
    throw new SaleReviewError("Proceeds must be above zero and fees cannot exceed proceeds.");
  }
  const event: PortfolioEventInput = {
    id: "sale-preview",
    type: "sale",
    sourceAccountId: input.sourceAccountId,
    instrumentId: input.instrumentId,
    asOf,
    quantity: quantity.toString(),
    proceeds: { amount: proceeds.toString(), currency: current.currency },
    fees: { amount: fees.toString(), currency: current.currency },
  };
  const next = buildPortfolioState({
    openingSnapshots: facts.openingSnapshots,
    events: [...facts.events, event],
  });
  const updated = next.positions.find((position) =>
    position.sourceAccountId === input.sourceAccountId && position.instrumentId === input.instrumentId)!;
  const currentCash = facts.state.cashBalances.find((cash) =>
    cash.sourceAccountId === input.sourceAccountId && cash.currency === current.currency);
  const updatedCash = next.cashBalances.find((cash) =>
    cash.sourceAccountId === input.sourceAccountId && cash.currency === current.currency)!;
  const soldCostBasis = new Decimal(current.costBasis).minus(updated.costBasis);
  const reviewToken = createHash("sha256").update(JSON.stringify({
    input, snapshots: facts.openingSnapshots, events: facts.events, state: facts.state,
  })).digest("hex");
  return {
    event, reviewToken,
    preview: {
      currency: current.currency,
      quantityBefore: current.quantity,
      quantityAfter: updated.quantity,
      costBasisBefore: current.costBasis,
      costBasisAfter: updated.costBasis,
      soldCostBasis: soldCostBasis.toString(),
      saleResult: proceeds.minus(fees).minus(soldCostBasis).toString(),
      cashBefore: currentCash?.amount ?? "0",
      cashAfter: updatedCash.amount,
    },
  };
}
