import Decimal from "decimal.js";

import type {
  OpeningPositionInput,
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";
import {
  identitiesOverlap,
  normalizedIdentityKeys,
} from "@/domain/portfolio/identity";
import {
  draftValue,
  type CashReconciliation,
  type DraftHolding,
  type DraftValue,
  type HoldingFieldChange,
  type HoldingReconciliation,
  type HoldingReconciliationKind,
  type HoldingStateComparison,
  type ImportDraftInput,
  type ImportReconciliation,
  type ImportSourceKind,
  type ImportUpdateMode,
} from "@/domain/import-draft";
import {
  draftPortfolioFromOpeningSnapshot,
  materializeOpeningSnapshot,
} from "@/domain/import-snapshot";

export * from "@/domain/import-draft";
export * from "@/domain/import-snapshot";

interface ImportLifecyclePolicy {
  updateMode: ImportUpdateMode;
  reviewScope: "complete-account" | "detected-holdings";
  preserveOmittedOnConfirmation: boolean;
}

const importLifecyclePolicies: Record<ImportSourceKind, ImportLifecyclePolicy> = {
  "trading-212": {
    updateMode: "complete",
    reviewScope: "complete-account",
    preserveOmittedOnConfirmation: false,
  },
  csv: {
    updateMode: "partial",
    reviewScope: "complete-account",
    preserveOmittedOnConfirmation: false,
  },
  manual: {
    updateMode: "partial",
    reviewScope: "complete-account",
    preserveOmittedOnConfirmation: false,
  },
  screenshot: {
    updateMode: "partial",
    reviewScope: "detected-holdings",
    preserveOmittedOnConfirmation: true,
  },
  demo: {
    updateMode: "partial",
    reviewScope: "detected-holdings",
    preserveOmittedOnConfirmation: false,
  },
};

export const legacyPartialSnapshotWarningMarker =
  "Previously confirmed holdings were included in this review. Removing one records that it is no longer held.";

export const completedPartialImportReviewWarning =
  legacyPartialSnapshotWarningMarker;

export const partialImportPreservationWarning =
  "This partial update shows only detected holdings. Other confirmed holdings stay unchanged.";

function holdingIdentityKeys(holding: DraftHolding): string[] {
  return normalizedIdentityKeys([
    draftValue(holding.instrumentId),
    draftValue(holding.instrumentCode),
  ]);
}

function sameHolding(left: DraftHolding, right: DraftHolding): boolean {
  return identitiesOverlap(holdingIdentityKeys(left), holdingIdentityKeys(right));
}

function sameHoldingAndPosition(
  holding: DraftHolding,
  position: PortfolioState["positions"][number],
): boolean {
  return identitiesOverlap(
    holdingIdentityKeys(holding),
    normalizedIdentityKeys([position.instrumentId, position.instrumentCode]),
  );
}

function sameDecimal(left: string, right: string): boolean {
  try {
    return new Decimal(left).equals(new Decimal(right));
  } catch {
    return left.trim() === right.trim();
  }
}

function holdingStateFromDraft(
  holding: DraftHolding,
): HoldingStateComparison | undefined {
  const instrumentId = draftValue(holding.instrumentId);
  const quantity = draftValue(holding.quantity);
  const costBasis = draftValue(holding.costBasis);
  const currency = draftValue(holding.currency);
  if (!instrumentId || quantity === undefined || costBasis === undefined || !currency) {
    return undefined;
  }
  const displayName = draftValue(holding.displayName);
  const instrumentCode = draftValue(holding.instrumentCode);
  return {
    instrumentId,
    ...(displayName ? { displayName } : {}),
    ...(instrumentCode ? { instrumentCode } : {}),
    quantity,
    costBasis,
    currency,
  };
}

function holdingStateFromPosition(
  position: PortfolioState["positions"][number],
): HoldingStateComparison {
  return {
    instrumentId: position.instrumentId,
    ...(position.displayName ? { displayName: position.displayName } : {}),
    ...(position.instrumentCode ? { instrumentCode: position.instrumentCode } : {}),
    quantity: position.quantity,
    costBasis: position.costBasis,
    currency: position.currency,
  };
}

function holdingFieldChanges(
  before: HoldingStateComparison,
  after: HoldingStateComparison,
): HoldingFieldChange[] {
  const changes: HoldingFieldChange[] = [];
  if (!sameDecimal(before.quantity, after.quantity)) {
    changes.push({ field: "quantity", before: before.quantity, after: after.quantity });
  }
  if (!sameDecimal(before.costBasis, after.costBasis)) {
    changes.push({ field: "costBasis", before: before.costBasis, after: after.costBasis });
  }
  if (before.currency.toUpperCase() !== after.currency.toUpperCase()) {
    changes.push({ field: "currency", before: before.currency, after: after.currency });
  }
  return changes;
}

function hasMarketDataDifference(
  holding: DraftHolding,
  position: PortfolioState["positions"][number],
): boolean {
  const proposedPrice = draftValue(holding.observedPrice);
  const proposedValue = draftValue(holding.reportedMarketValue);
  const proposedAsOf = draftValue(holding.priceAsOf);
  return (
    (proposedPrice !== undefined &&
      (position.observedPrice === undefined ||
        !sameDecimal(proposedPrice, position.observedPrice))) ||
    (proposedValue !== undefined &&
      (position.reportedMarketValue === undefined ||
        !sameDecimal(proposedValue, position.reportedMarketValue))) ||
    (proposedAsOf !== undefined && proposedAsOf !== position.priceAsOf)
  );
}

function cashReconciliation(
  draft: ImportDraftInput,
  currentState: PortfolioState,
  mode: ImportUpdateMode,
): CashReconciliation | undefined {
  const proposed = draftValue(draft.portfolio.portfolioCash);
  const current = currentState.cashBalances.find(
    (cash) => cash.sourceAccountId === draft.sourceAccountId,
  );
  const before = current
    ? { amount: current.amount, currency: current.currency }
    : undefined;
  if (!before && !proposed) return undefined;
  if (!before && proposed) return { kind: "new", after: proposed };
  if (before && !proposed) {
    return mode === "complete"
      ? { kind: "possibly-removed", before }
      : { kind: "unchanged", before, after: before };
  }
  if (
    before &&
    proposed &&
    sameDecimal(before.amount, proposed.amount) &&
    before.currency.toUpperCase() === proposed.currency.toUpperCase()
  ) {
    return { kind: "unchanged", before, after: proposed };
  }
  return { kind: "holding-changed", before, after: proposed };
}

export function reconcileImportDraft(
  draft: ImportDraftInput,
  currentState: PortfolioState,
): ImportReconciliation {
  const mode = importLifecyclePolicies[draft.sourceKind].updateMode;
  const currentPositions = currentState.positions.filter(
    (position) => position.sourceAccountId === draft.sourceAccountId,
  );
  const matchedCurrent = new Set<number>();
  const holdings: HoldingReconciliation[] = draft.portfolio.holdings.map((holding) => {
    const currentIndex = currentPositions.findIndex(
      (position, index) =>
        !matchedCurrent.has(index) && sameHoldingAndPosition(holding, position),
    );
    const after = holdingStateFromDraft(holding);
    if (currentIndex < 0 || !after) {
      return {
        key: holding.lineId,
        proposedLineId: holding.lineId,
        kind: "new" as const,
        ...(after ? { after } : {}),
        changes: [],
      };
    }
    matchedCurrent.add(currentIndex);
    const before = holdingStateFromPosition(currentPositions[currentIndex]!);
    const changes = holdingFieldChanges(before, after);
    const hasMarketObservation = !holding.lineId.startsWith("carried:") &&
      hasMarketDataDifference(holding, currentPositions[currentIndex]!);
    return {
      key: `${draft.sourceAccountId}:${before.instrumentId}`,
      proposedLineId: holding.lineId,
      kind: changes.length > 0
        ? "holding-changed" as const
        : hasMarketObservation
          ? "market-data-updated" as const
          : "unchanged" as const,
      before,
      after,
      changes,
    };
  });

  if (mode === "complete") {
    currentPositions.forEach((position, index) => {
      if (matchedCurrent.has(index)) return;
      const before = holdingStateFromPosition(position);
      holdings.push({
        key: `${draft.sourceAccountId}:${before.instrumentId}`,
        kind: "possibly-removed",
        before,
        changes: [],
      });
    });
  }

  const cash = cashReconciliation(draft, currentState, mode);
  const changeKinds = new Set<HoldingReconciliationKind>([
    "holding-changed",
    "new",
    "possibly-removed",
  ]);
  const holdingChangeCount = holdings.filter((item) => changeKinds.has(item.kind)).length;
  const cashChangeCount = cash && cash.kind !== "unchanged" ? 1 : 0;
  const hasCurrentState = currentPositions.length > 0 ||
    currentState.cashBalances.some(
      (balance) => balance.sourceAccountId === draft.sourceAccountId,
    );

  return {
    mode,
    snapshotKind: hasCurrentState ? "holding-state" : "opening",
    changeCount: holdingChangeCount + cashChangeCount,
    unchangedCount: holdings.filter((item) => item.kind === "unchanged").length,
    marketDataUpdatedCount: holdings.filter(
      (item) => item.kind === "market-data-updated",
    ).length,
    holdings,
    ...(cash ? { cash } : {}),
  };
}

function preferUpdatedValue<T>(
  previous: DraftValue<T>,
  updated: DraftValue<T>,
): DraftValue<T> {
  return updated.status === "unknown" ? previous : updated;
}

function mergedHoldingMetadata(
  previous: DraftHolding,
  updated: DraftHolding,
): Pick<DraftHolding, "displayName" | "instrumentCode" | "assetType"> {
  return {
    displayName: preferUpdatedValue(previous.displayName, updated.displayName),
    instrumentCode: preferUpdatedValue(previous.instrumentCode, updated.instrumentCode),
    assetType: preferUpdatedValue(previous.assetType, updated.assetType),
  };
}

function mergeHolding(previous: DraftHolding, updated: DraftHolding): DraftHolding {
  return {
    lineId: updated.lineId,
    instrumentId: preferUpdatedValue(previous.instrumentId, updated.instrumentId),
    ...mergedHoldingMetadata(previous, updated),
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

function preserveTrading212Metadata(
  previous: DraftHolding,
  updated: DraftHolding,
): DraftHolding {
  const metadata = mergedHoldingMetadata(previous, updated);
  return {
    ...updated,
    ...metadata,
    instrumentId: previous.instrumentId,
    reportedPriorReturn: previous.reportedPriorReturn,
    // Once reviewed, classification is owner-controlled. A later API sync can
    // update position values, but it must not undo an ETF correction.
    assetType: previous.assetType.status === "unknown"
      ? updated.assetType
      : previous.assetType,
  };
}

export function prepareImportDraftForReview(
  draft: ImportDraftInput,
  currentState: PortfolioState,
): ImportDraftInput {
  const currentPositions = currentState.positions.filter(
    (position) => position.sourceAccountId === draft.sourceAccountId,
  );
  const currentCash = currentState.cashBalances.find(
    (cash) => cash.sourceAccountId === draft.sourceAccountId,
  );
  if (currentPositions.length === 0 && !currentCash) {
    return {
      ...draft,
      portfolio: {
        ...draft.portfolio,
        reconciliation: reconcileImportDraft(draft, currentState),
      },
    };
  }
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

  let preparedDraft = draft;
  if (draft.sourceKind === "trading-212") {
    preparedDraft = {
      ...draft,
      portfolio: {
        ...draft.portfolio,
        holdings: draft.portfolio.holdings.map((updated) => {
          const previous = previousPortfolio.holdings.find((candidate) =>
            sameHolding(candidate, updated)
          );
          return previous ? preserveTrading212Metadata(previous, updated) : updated;
        }),
      },
    };
  } else if (draft.sourceKind !== "demo") {
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
    const reviewOnlyDetectedHoldings =
      importLifecyclePolicies[draft.sourceKind].reviewScope === "detected-holdings";

    preparedDraft = {
      ...draft,
      warnings: [
        ...draft.warnings,
        ...(reviewOnlyDetectedHoldings &&
            !draft.warnings.includes(partialImportPreservationWarning)
          ? [partialImportPreservationWarning]
          : []),
        ...(!reviewOnlyDetectedHoldings &&
            !draft.warnings.includes(completedPartialImportReviewWarning)
          ? [completedPartialImportReviewWarning]
          : []),
        ...(!reviewOnlyDetectedHoldings &&
            carryWarning &&
            !draft.warnings.includes(carryWarning)
          ? [carryWarning]
          : []),
      ],
      portfolio: {
        ...draft.portfolio,
        portfolioCash: reviewOnlyDetectedHoldings ||
            draft.portfolio.portfolioCash.status !== "unknown"
          ? draft.portfolio.portfolioCash
          : previousPortfolio.portfolioCash,
        holdings: reviewOnlyDetectedHoldings
          ? updatedHoldings
          : [...updatedHoldings, ...carriedHoldings],
      },
    };
  }

  return {
    ...preparedDraft,
    portfolio: {
      ...preparedDraft.portfolio,
      reconciliation: reconcileImportDraft(preparedDraft, currentState),
    },
  };
}

export type SnapshotPayloadScope = "complete" | "legacy-partial";

export interface SnapshotHistoryRecord {
  snapshot: OpeningSnapshotInput;
  payloadScope: SnapshotPayloadScope;
}

function positionIdentityKeys(position: OpeningPositionInput): string[] {
  return normalizedIdentityKeys([position.instrumentId, position.instrumentCode]);
}

function samePosition(
  left: OpeningPositionInput,
  right: OpeningPositionInput,
): boolean {
  return identitiesOverlap(positionIdentityKeys(left), positionIdentityKeys(right));
}

function openingPositionFromState(
  position: PortfolioState["positions"][number],
): OpeningPositionInput {
  return {
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
  };
}

export function materializeConfirmedImportSnapshot(input: {
  draft: ImportDraftInput;
  currentState: PortfolioState;
  snapshotKind: ImportReconciliation["snapshotKind"];
}): OpeningSnapshotInput {
  const snapshot = materializeOpeningSnapshot(
    input.draft.sourceAccountId,
    input.draft.portfolio,
    input.snapshotKind,
  );
  if (!importLifecyclePolicies[input.draft.sourceKind].preserveOmittedOnConfirmation) {
    return snapshot;
  }

  const currentPositions = input.currentState.positions
    .filter((position) =>
      position.sourceAccountId === input.draft.sourceAccountId
    )
    .map(openingPositionFromState);
  const omittedPositions = currentPositions.filter((position) =>
    !snapshot.positions.some((updated) => samePosition(position, updated))
  );
  const currentCash = input.currentState.cashBalances.find((cash) =>
    cash.sourceAccountId === input.draft.sourceAccountId
  );

  return {
    ...snapshot,
    ...(!snapshot.portfolioCash && currentCash
      ? {
          portfolioCash: {
            amount: currentCash.amount,
            currency: currentCash.currency,
          },
        }
      : {}),
    positions: [...snapshot.positions, ...omittedPositions],
  };
}

export function normalizeSnapshotHistory(
  records: readonly SnapshotHistoryRecord[],
): OpeningSnapshotInput[] {
  const latestByAccount = new Map<string, OpeningSnapshotInput>();
  const accountsWithSnapshot = new Set<string>();
  return records.map((record) => {
    const previous = latestByAccount.get(record.snapshot.sourceAccountId);
    const isLegacyPartialUpdate = previous && record.payloadScope === "legacy-partial";
    const restoredSnapshot = isLegacyPartialUpdate
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
    const snapshot = {
      ...restoredSnapshot,
      kind: restoredSnapshot.kind ??
        (accountsWithSnapshot.has(restoredSnapshot.sourceAccountId)
          ? "holding-state" as const
          : "opening" as const),
    };
    accountsWithSnapshot.add(snapshot.sourceAccountId);
    latestByAccount.set(snapshot.sourceAccountId, snapshot);
    return snapshot;
  });
}
