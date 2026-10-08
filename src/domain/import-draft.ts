import type { AssetType, CashDestination, MoneyInput } from "@/domain/portfolio/types";

// Keep the retired demo value readable so older local drafts remain isolated.
export const importSourceKinds = [
  "screenshot",
  "trading-212",
  "manual",
  "demo",
  "csv",
] as const;

export type ImportSourceKind = (typeof importSourceKinds)[number];

export type ImportFieldSource = "vision" | "csv" | "api" | "manual" | "demo";

export type DraftValue<T> =
  | {
      status: "known";
      value: T;
      source: ImportFieldSource;
      confidence?: "low" | "medium" | "high";
    }
  | {
      status: "inferred";
      value: T;
      reason: string;
    }
  | { status: "unknown" };

export interface DraftHolding {
  lineId: string;
  instrumentId: DraftValue<string>;
  displayName: DraftValue<string>;
  instrumentCode: DraftValue<string>;
  assetType: DraftValue<AssetType>;
  quantity: DraftValue<string>;
  currency: DraftValue<string>;
  costBasis: DraftValue<string>;
  reportedPriorReturn: DraftValue<string>;
  averageCost: DraftValue<string>;
  observedPrice: DraftValue<string>;
  priceAsOf: DraftValue<string>;
  priceSource: DraftValue<string>;
  reportedMarketValue: DraftValue<string>;
}

export type ImportReductionReview = {
  instrumentId: string;
  quantity: string;
} & (
  | { kind: "sale"; proceeds: string; fees: string; destination: CashDestination }
  | { kind: "adjustment"; reason: string }
);

export interface DraftPortfolio {
  snapshotId: string;
  asOf: DraftValue<string>;
  portfolioCash: DraftValue<MoneyInput>;
  holdings: DraftHolding[];
  reconciliation?: ImportReconciliation;
  reductionReviews?: ImportReductionReview[];
}

export type ImportUpdateMode = "complete" | "partial";

export type HoldingReconciliationKind =
  | "unchanged"
  | "market-data-updated"
  | "holding-changed"
  | "new"
  | "possibly-removed";

export type HoldingStateField = "quantity" | "costBasis" | "currency";

export interface HoldingStateComparison {
  instrumentId: string;
  displayName?: string;
  instrumentCode?: string;
  quantity: string;
  costBasis: string;
  currency: string;
}

export interface HoldingFieldChange {
  field: HoldingStateField;
  before?: string;
  after?: string;
}

export interface HoldingReconciliation {
  key: string;
  proposedLineId?: string;
  kind: HoldingReconciliationKind;
  before?: HoldingStateComparison;
  after?: HoldingStateComparison;
  changes: HoldingFieldChange[];
}

export interface CashReconciliation {
  kind: "unchanged" | "holding-changed" | "new" | "possibly-removed";
  before?: MoneyInput;
  after?: MoneyInput;
}

export interface ImportReconciliation {
  mode: ImportUpdateMode;
  snapshotKind: "opening" | "holding-state";
  changeCount: number;
  unchangedCount: number;
  marketDataUpdatedCount: number;
  holdings: HoldingReconciliation[];
  cash?: CashReconciliation;
}

export interface ImportDraftInput {
  id: string;
  sourceAccountId: string;
  sourceKind: ImportSourceKind;
  createdAt: string;
  confidence: string;
  warnings: readonly string[];
  portfolio: DraftPortfolio;
}

export interface StoredImportDraft extends ImportDraftInput {
  status: "draft" | "confirmed" | "discarded";
  confirmedAt?: string;
}

export interface ImportDraftReview {
  confidence: string;
  warnings: readonly string[];
  portfolio: DraftPortfolio;
}

export interface ConfirmedImportRecord {
  id: string;
  draftId: string;
  sourceAccountId: string;
  sourceKind: ImportSourceKind;
  confirmedAt: string;
}

export function knownDraftValue<T>(
  value: T,
  source: ImportFieldSource,
  confidence?: "low" | "medium" | "high",
): DraftValue<T> {
  return {
    status: "known",
    value,
    source,
    ...(confidence ? { confidence } : {}),
  };
}

export function inferredDraftValue<T>(
  value: T,
  reason: string,
): DraftValue<T> {
  return { status: "inferred", value, reason };
}

export function unknownDraftValue<T>(): DraftValue<T> {
  return { status: "unknown" };
}

export function draftValue<T>(value: DraftValue<T>): T | undefined {
  return value.status === "unknown" ? undefined : value.value;
}
