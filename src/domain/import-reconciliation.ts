import {
  draftValue,
  type CashReconciliation,
  type DraftHolding,
  type HoldingReconciliation,
  type HoldingReconciliationKind,
  type HoldingStateComparison,
  type ImportDraftInput,
  type ImportReconciliation,
  type ImportUpdateMode,
} from "@/domain/import-draft";
import {
  holdingStateFieldChanges,
  sameDecimalValue,
} from "@/domain/holding-state-comparison";
import { importLifecyclePolicyFor } from "@/domain/import-lifecycle-policy";
import {
  identitiesOverlap,
  normalizedIdentityKeys,
} from "@/domain/portfolio/identity";
import type { PortfolioState } from "@/domain/portfolio/types";

function holdingIdentityKeys(holding: DraftHolding): string[] {
  return normalizedIdentityKeys([
    draftValue(holding.instrumentId),
    draftValue(holding.instrumentCode),
  ]);
}

export function sameDraftHolding(
  left: DraftHolding,
  right: DraftHolding,
): boolean {
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
        !sameDecimalValue(proposedPrice, position.observedPrice))) ||
    (proposedValue !== undefined &&
      (position.reportedMarketValue === undefined ||
        !sameDecimalValue(proposedValue, position.reportedMarketValue))) ||
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
    sameDecimalValue(before.amount, proposed.amount) &&
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
  const mode = importLifecyclePolicyFor(draft.sourceKind).updateMode;
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
    const changes = holdingStateFieldChanges(before, after);
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
