import {
  draftValue,
  type DraftHolding,
  type DraftValue,
  type ImportDraftInput,
} from "@/domain/import-draft";
import {
  completedPartialImportReviewWarning,
  importLifecyclePolicyFor,
  partialImportPreservationWarning,
} from "@/domain/import-lifecycle-policy";
import {
  reconcileImportDraft,
  sameDraftHolding,
} from "@/domain/import-reconciliation";
import {
  draftPortfolioFromOpeningSnapshot,
  openingPositionFromPortfolioState,
} from "@/domain/import-snapshot";
import type { PortfolioState } from "@/domain/portfolio/types";

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
    positions: currentPositions.map(openingPositionFromPortfolioState),
  }, "manual");

  let preparedDraft = draft;
  if (draft.sourceKind === "trading-212") {
    preparedDraft = {
      ...draft,
      portfolio: {
        ...draft.portfolio,
        holdings: draft.portfolio.holdings.map((updated) => {
          const previous = previousPortfolio.holdings.find((candidate) =>
            sameDraftHolding(candidate, updated)
          );
          return previous ? preserveTrading212Metadata(previous, updated) : updated;
        }),
      },
    };
  } else if (draft.sourceKind !== "demo") {
    const matchedPrevious = new Set<number>();
    const updatedHoldings = draft.portfolio.holdings.map((updated) => {
      const previousIndex = previousPortfolio.holdings.findIndex(
        (previous, index) =>
          !matchedPrevious.has(index) && sameDraftHolding(previous, updated),
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
      importLifecyclePolicyFor(draft.sourceKind).reviewScope === "detected-holdings";

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
