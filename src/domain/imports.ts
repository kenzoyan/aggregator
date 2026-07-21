import type {
  AssetType,
  MoneyInput,
  OpeningPositionInput,
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";

export const importSourceKinds = [
  "screenshot",
  "trading-212",
  "manual",
  "demo",
  "csv",
] as const;

export type ImportSourceKind = (typeof importSourceKinds)[number];

export type ImportFieldSource = "ocr" | "csv" | "api" | "manual" | "demo";

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

export interface DraftPortfolio {
  snapshotId: string;
  asOf: DraftValue<string>;
  portfolioCash: DraftValue<MoneyInput>;
  holdings: DraftHolding[];
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

function requiredDraftValue<T>(
  value: DraftValue<T>,
  path: string,
): T {
  const resolved = draftValue(value);
  if (resolved === undefined) {
    throw new Error(`${path} is still unknown`);
  }
  return resolved;
}

function materializeHolding(
  holding: DraftHolding,
  index: number,
): OpeningPositionInput {
  const path = `Holding ${index + 1}`;
  const displayName = draftValue(holding.displayName);
  const instrumentCode = draftValue(holding.instrumentCode);
  const assetType = draftValue(holding.assetType);
  const reportedPriorReturn = draftValue(holding.reportedPriorReturn);
  const averageCost = draftValue(holding.averageCost);
  const observedPrice = draftValue(holding.observedPrice);
  const priceAsOf = draftValue(holding.priceAsOf);
  const priceSource = draftValue(holding.priceSource);
  const reportedMarketValue = draftValue(holding.reportedMarketValue);

  return {
    instrumentId: requiredDraftValue(
      holding.instrumentId,
      `${path} instrumentId`,
    ),
    ...(displayName ? { displayName } : {}),
    ...(instrumentCode ? { instrumentCode } : {}),
    ...(assetType ? { assetType } : {}),
    quantity: requiredDraftValue(holding.quantity, `${path} quantity`),
    currency: requiredDraftValue(holding.currency, `${path} currency`),
    costBasis: requiredDraftValue(holding.costBasis, `${path} costBasis`),
    ...(reportedPriorReturn !== undefined ? { reportedPriorReturn } : {}),
    ...(averageCost ? { averageCost } : {}),
    ...(observedPrice ? { observedPrice } : {}),
    ...(priceAsOf ? { priceAsOf } : {}),
    ...(priceSource ? { priceSource } : {}),
    ...(reportedMarketValue ? { reportedMarketValue } : {}),
  };
}

export function materializeOpeningSnapshot(
  sourceAccountId: string,
  portfolio: DraftPortfolio,
): OpeningSnapshotInput {
  const portfolioCash = draftValue(portfolio.portfolioCash);
  return {
    id: portfolio.snapshotId,
    sourceAccountId,
    asOf: requiredDraftValue(portfolio.asOf, "Portfolio asOf"),
    ...(portfolioCash ? { portfolioCash } : {}),
    positions: portfolio.holdings.map(materializeHolding),
  };
}

export function draftPortfolioFromOpeningSnapshot(
  snapshot: OpeningSnapshotInput,
  source: ImportFieldSource,
): DraftPortfolio {
  return {
    snapshotId: snapshot.id,
    asOf: knownDraftValue(snapshot.asOf, source),
    portfolioCash: snapshot.portfolioCash
      ? knownDraftValue(snapshot.portfolioCash, source)
      : unknownDraftValue(),
    holdings: snapshot.positions.map((position, index) => ({
      lineId: `${snapshot.id}:line:${index + 1}`,
      instrumentId: knownDraftValue(position.instrumentId, source),
      displayName: position.displayName
        ? knownDraftValue(position.displayName, source)
        : unknownDraftValue(),
      instrumentCode: position.instrumentCode
        ? knownDraftValue(position.instrumentCode, source)
        : unknownDraftValue(),
      assetType: position.assetType
        ? knownDraftValue(position.assetType, source)
        : unknownDraftValue(),
      quantity: knownDraftValue(position.quantity, source),
      currency: knownDraftValue(position.currency, source),
      costBasis: knownDraftValue(position.costBasis, source),
      reportedPriorReturn: position.reportedPriorReturn !== undefined
        ? knownDraftValue(position.reportedPriorReturn, source)
        : unknownDraftValue(),
      averageCost: position.averageCost
        ? knownDraftValue(position.averageCost, source)
        : unknownDraftValue(),
      observedPrice: position.observedPrice
        ? knownDraftValue(position.observedPrice, source)
        : unknownDraftValue(),
      priceAsOf: position.priceAsOf
        ? knownDraftValue(position.priceAsOf, source)
        : unknownDraftValue(),
      priceSource: position.priceSource
        ? knownDraftValue(position.priceSource, source)
        : unknownDraftValue(),
      reportedMarketValue: position.reportedMarketValue
        ? knownDraftValue(position.reportedMarketValue, source)
        : unknownDraftValue(),
    })),
  };
}

const partialImportSourceKinds = new Set<ImportSourceKind>([
  "csv",
  "manual",
  "screenshot",
]);

export const completedPartialImportReviewWarning =
  "Previously confirmed holdings were included in this review. Removing one records that it is no longer held.";

function holdingIdentityKeys(holding: DraftHolding): string[] {
  return [draftValue(holding.instrumentId), draftValue(holding.instrumentCode)]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toUpperCase());
}

function sameHolding(left: DraftHolding, right: DraftHolding): boolean {
  const leftKeys = new Set(holdingIdentityKeys(left));
  return holdingIdentityKeys(right).some((key) => leftKeys.has(key));
}

function preferUpdatedValue<T>(
  previous: DraftValue<T>,
  updated: DraftValue<T>,
): DraftValue<T> {
  return updated.status === "unknown" ? previous : updated;
}

function mergeHolding(previous: DraftHolding, updated: DraftHolding): DraftHolding {
  return {
    lineId: updated.lineId,
    instrumentId: preferUpdatedValue(previous.instrumentId, updated.instrumentId),
    displayName: preferUpdatedValue(previous.displayName, updated.displayName),
    instrumentCode: preferUpdatedValue(previous.instrumentCode, updated.instrumentCode),
    assetType: preferUpdatedValue(previous.assetType, updated.assetType),
    quantity: preferUpdatedValue(previous.quantity, updated.quantity),
    currency: preferUpdatedValue(previous.currency, updated.currency),
    costBasis: preferUpdatedValue(previous.costBasis, updated.costBasis),
    reportedPriorReturn: preferUpdatedValue(
      previous.reportedPriorReturn,
      updated.reportedPriorReturn,
    ),
    averageCost: preferUpdatedValue(previous.averageCost, updated.averageCost),
    observedPrice: preferUpdatedValue(previous.observedPrice, updated.observedPrice),
    priceAsOf: preferUpdatedValue(previous.priceAsOf, updated.priceAsOf),
    priceSource: preferUpdatedValue(previous.priceSource, updated.priceSource),
    reportedMarketValue: preferUpdatedValue(
      previous.reportedMarketValue,
      updated.reportedMarketValue,
    ),
  };
}

export function completePartialImportDraft(
  draft: ImportDraftInput,
  currentState: PortfolioState,
): ImportDraftInput {
  if (!partialImportSourceKinds.has(draft.sourceKind)) return draft;

  const currentPositions = currentState.positions.filter(
    (position) => position.sourceAccountId === draft.sourceAccountId,
  );
  const currentCash = currentState.cashBalances.find(
    (cash) => cash.sourceAccountId === draft.sourceAccountId,
  );
  if (currentPositions.length === 0 && !currentCash) return draft;

  const previousPortfolio = draftPortfolioFromOpeningSnapshot({
    id: `carried:${draft.portfolio.snapshotId}`,
    sourceAccountId: draft.sourceAccountId,
    asOf: draftValue(draft.portfolio.asOf) ?? draft.createdAt,
    ...(currentCash
      ? { portfolioCash: { amount: currentCash.amount, currency: currentCash.currency } }
      : {}),
    positions: currentPositions.map((position) => ({
      instrumentId: position.instrumentId,
      ...(position.displayName ? { displayName: position.displayName } : {}),
      ...(position.instrumentCode ? { instrumentCode: position.instrumentCode } : {}),
      ...(position.assetType ? { assetType: position.assetType } : {}),
      quantity: position.quantity,
      currency: position.currency,
      costBasis: position.costBasis,
      reportedPriorReturn: position.reportedPriorReturn,
      ...(position.averageCost ? { averageCost: position.averageCost } : {}),
      ...(position.observedPrice ? { observedPrice: position.observedPrice } : {}),
      ...(position.priceAsOf ? { priceAsOf: position.priceAsOf } : {}),
      ...(position.priceSource ? { priceSource: position.priceSource } : {}),
      ...(position.reportedMarketValue
        ? { reportedMarketValue: position.reportedMarketValue }
        : {}),
    })),
  }, "manual");

  const matchedPrevious = new Set<number>();
  const updatedHoldings = draft.portfolio.holdings.map((updated) => {
    const previousIndex = previousPortfolio.holdings.findIndex(
      (previous, index) => !matchedPrevious.has(index) && sameHolding(previous, updated),
    );
    if (previousIndex < 0) return updated;
    matchedPrevious.add(previousIndex);
    return mergeHolding(previousPortfolio.holdings[previousIndex]!, updated);
  });
  const carriedHoldings = previousPortfolio.holdings.filter(
    (_, index) => !matchedPrevious.has(index),
  );
  const carryWarning = carriedHoldings.length > 0
    ? `${carriedHoldings.length} previously confirmed holding${carriedHoldings.length === 1 ? " was" : "s were"} carried forward. Remove only holdings that are no longer held.`
    : undefined;

  return {
    ...draft,
    warnings: [
      ...draft.warnings,
      ...(!draft.warnings.includes(completedPartialImportReviewWarning)
        ? [completedPartialImportReviewWarning]
        : []),
      ...(carryWarning && !draft.warnings.includes(carryWarning)
        ? [carryWarning]
        : []),
    ],
    portfolio: {
      ...draft.portfolio,
      portfolioCash: draft.portfolio.portfolioCash.status === "unknown"
        ? previousPortfolio.portfolioCash
        : draft.portfolio.portfolioCash,
      holdings: [...updatedHoldings, ...carriedHoldings],
    },
  };
}

export interface ConfirmedSnapshotImport {
  snapshot: OpeningSnapshotInput;
  sourceKind: ImportSourceKind;
  warnings: readonly string[];
}

function positionIdentityKeys(position: OpeningPositionInput): string[] {
  return [position.instrumentId, position.instrumentCode]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toUpperCase());
}

function samePosition(
  left: OpeningPositionInput,
  right: OpeningPositionInput,
): boolean {
  const leftKeys = new Set(positionIdentityKeys(left));
  return positionIdentityKeys(right).some((key) => leftKeys.has(key));
}

export function restoreLegacyPartialSnapshots(
  imports: readonly ConfirmedSnapshotImport[],
): OpeningSnapshotInput[] {
  const latestByAccount = new Map<string, OpeningSnapshotInput>();
  return imports.map((record) => {
    const previous = latestByAccount.get(record.snapshot.sourceAccountId);
    const isLegacyPartialUpdate =
      previous &&
      partialImportSourceKinds.has(record.sourceKind) &&
      !record.warnings.includes(completedPartialImportReviewWarning);
    const snapshot = isLegacyPartialUpdate
      ? {
          ...record.snapshot,
          ...(!record.snapshot.portfolioCash && previous.portfolioCash
            ? { portfolioCash: previous.portfolioCash }
            : {}),
          positions: [
            ...record.snapshot.positions,
            ...previous.positions.filter((previousPosition) =>
              !record.snapshot.positions.some((currentPosition) =>
                samePosition(previousPosition, currentPosition)
              )
            ),
          ],
        }
      : record.snapshot;
    latestByAccount.set(snapshot.sourceAccountId, snapshot);
    return snapshot;
  });
}
