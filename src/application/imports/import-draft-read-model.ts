import {
  draftValue,
  knownDraftValue,
  unknownDraftValue,
  type DraftHolding,
  type DraftPortfolio,
  type DraftValue,
  type ImportDraftInput,
  type ImportReconciliation,
  type ImportReductionReview,
  type ImportDraftReview,
  type StoredImportDraft,
} from "@/domain/imports";
import type {
  AssetType,
  MoneyInput,
} from "@/domain/portfolio/types";

export interface EditableDraftHolding {
  lineId: string;
  instrumentId: string;
  displayName?: string;
  instrumentCode?: string;
  assetType?: AssetType;
  quantity: string;
  currency: string;
  costBasis: string;
  reportedPriorReturn?: string;
  averageCost?: string;
  observedPrice?: string;
  priceAsOf?: string;
  priceSource?: string;
  reportedMarketValue?: string;
}

export interface EditableDraftPortfolio {
  reductionReviews?: ImportReductionReview[];
  snapshotId: string;
  asOf: string;
  portfolioCash?: MoneyInput;
  holdings: EditableDraftHolding[];
}

export interface EditableImportDraftReview {
  confidence: string;
  warnings: string[];
  portfolio: EditableDraftPortfolio;
}

export interface ImportDraftReadModel extends EditableImportDraftReview {
  id: string;
  sourceAccountId: string;
  sourceKind: StoredImportDraft["sourceKind"];
  createdAt: string;
  status: StoredImportDraft["status"];
  confirmedAt?: string;
  reconciliation?: ImportReconciliation;
}

export function createImportDraftConfirmationPayload(
  draft: ImportDraftReadModel,
): EditableImportDraftReview {
  return {
    confidence: draft.confidence,
    warnings: [...draft.warnings],
    portfolio: draft.portfolio,
  };
}

function editableHolding(holding: DraftHolding): EditableDraftHolding {
  return {
    lineId: holding.lineId,
    instrumentId: draftValue(holding.instrumentId) ?? "",
    ...(draftValue(holding.displayName)
      ? { displayName: draftValue(holding.displayName) }
      : {}),
    ...(draftValue(holding.instrumentCode)
      ? { instrumentCode: draftValue(holding.instrumentCode) }
      : {}),
    ...(draftValue(holding.assetType)
      ? { assetType: draftValue(holding.assetType) }
      : {}),
    quantity: draftValue(holding.quantity) ?? "",
    currency: draftValue(holding.currency) ?? "",
    costBasis: draftValue(holding.costBasis) ?? "",
    ...(draftValue(holding.reportedPriorReturn) !== undefined
      ? { reportedPriorReturn: draftValue(holding.reportedPriorReturn) }
      : {}),
    ...(draftValue(holding.averageCost)
      ? { averageCost: draftValue(holding.averageCost) }
      : {}),
    ...(draftValue(holding.observedPrice)
      ? { observedPrice: draftValue(holding.observedPrice) }
      : {}),
    ...(draftValue(holding.priceAsOf)
      ? { priceAsOf: draftValue(holding.priceAsOf) }
      : {}),
    ...(draftValue(holding.priceSource)
      ? { priceSource: draftValue(holding.priceSource) }
      : {}),
    ...(draftValue(holding.reportedMarketValue)
      ? { reportedMarketValue: draftValue(holding.reportedMarketValue) }
      : {}),
  };
}

export function createImportDraftReadModel(
  draft: StoredImportDraft,
): ImportDraftReadModel {
  return {
    id: draft.id,
    sourceAccountId: draft.sourceAccountId,
    sourceKind: draft.sourceKind,
    createdAt: draft.createdAt,
    confidence: draft.confidence,
    warnings: [...draft.warnings],
    status: draft.status,
    ...(draft.confirmedAt ? { confirmedAt: draft.confirmedAt } : {}),
    ...(draft.portfolio.reconciliation
      ? { reconciliation: draft.portfolio.reconciliation }
      : {}),
    portfolio: {
      ...(draft.portfolio.reductionReviews ? { reductionReviews: draft.portfolio.reductionReviews } : {}),
      snapshotId: draft.portfolio.snapshotId,
      asOf: draftValue(draft.portfolio.asOf) ?? "",
      ...(draftValue(draft.portfolio.portfolioCash)
        ? { portfolioCash: draftValue(draft.portfolio.portfolioCash) }
        : {}),
      holdings: draft.portfolio.holdings.map(editableHolding),
    },
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reviewedValue<T>(
  existing: DraftValue<T> | undefined,
  value: T | undefined,
): DraftValue<T> {
  if (value === undefined || value === "") return unknownDraftValue();
  if (
    existing &&
    existing.status !== "unknown" &&
    sameValue(existing.value, value)
  ) {
    return existing;
  }
  return knownDraftValue(value, "manual");
}

function reviewedHolding(
  holding: EditableDraftHolding,
  existing?: DraftHolding,
): DraftHolding {
  return {
    lineId: holding.lineId,
    instrumentId: reviewedValue(existing?.instrumentId, holding.instrumentId),
    displayName: reviewedValue(existing?.displayName, holding.displayName),
    instrumentCode: reviewedValue(existing?.instrumentCode, holding.instrumentCode),
    assetType: reviewedValue(existing?.assetType, holding.assetType),
    quantity: reviewedValue(existing?.quantity, holding.quantity),
    currency: reviewedValue(existing?.currency, holding.currency),
    costBasis: reviewedValue(existing?.costBasis, holding.costBasis),
    reportedPriorReturn: reviewedValue(
      existing?.reportedPriorReturn,
      holding.reportedPriorReturn,
    ),
    averageCost: reviewedValue(existing?.averageCost, holding.averageCost),
    observedPrice: reviewedValue(existing?.observedPrice, holding.observedPrice),
    priceAsOf: reviewedValue(existing?.priceAsOf, holding.priceAsOf),
    priceSource: reviewedValue(existing?.priceSource, holding.priceSource),
    reportedMarketValue: reviewedValue(
      existing?.reportedMarketValue,
      holding.reportedMarketValue,
    ),
  };
}

export function applyImportDraftReview(
  existingDraft: ImportDraftInput,
  review: EditableImportDraftReview,
): ImportDraftReview {
  const existingByLineId = new Map(
    existingDraft.portfolio.holdings.map((holding) => [holding.lineId, holding]),
  );
  const portfolio: DraftPortfolio = {
    ...(review.portfolio.reductionReviews ? { reductionReviews: review.portfolio.reductionReviews } : {}),
    snapshotId: existingDraft.portfolio.snapshotId,
    asOf: reviewedValue(existingDraft.portfolio.asOf, review.portfolio.asOf),
    portfolioCash: reviewedValue(
      existingDraft.portfolio.portfolioCash,
      review.portfolio.portfolioCash,
    ),
    holdings: review.portfolio.holdings.map((holding) =>
      reviewedHolding(holding, existingByLineId.get(holding.lineId))
    ),
  };

  return {
    confidence: review.confidence,
    warnings: [...review.warnings],
    portfolio,
  };
}
