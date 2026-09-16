import { createEurCnyOverview, eurPerUnitAt } from "@/application/fx-history";
import { createHoldingHistoryReadModel } from "@/application/holding-history";
import { createCurrentPortfolioValuationReadModel } from "@/application/portfolio-current-valuation";
import { createPortfolioHistoryReadModel } from "@/application/portfolio-history";
import { combinePortfolioPeriodHistory } from "@/application/portfolio-periods";
import type {
  HoldingReadModel,
  PortfolioOverviewReadModel,
  SourceAccountAllocationReadModel,
} from "@/application/portfolio-read-model";
import type {
  FxRateObservation,
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type {
  OpeningSnapshotInput,
  PortfolioEventInput,
} from "@/domain/portfolio/types";

export interface PortfolioValuationTimelineInput {
  snapshots: OpeningSnapshotInput[];
  events: PortfolioEventInput[];
  marketPrices: MarketPriceObservation[];
  fxObservations: FxRateObservation[];
  marketRefreshHistory?: MarketRefreshRecord[];
  accountLabels: Record<string, string>;
  asOf: string;
}

function createSourceAccountAllocation(
  holdings: readonly HoldingReadModel[],
  totalValueEur: number,
): SourceAccountAllocationReadModel[] {
  const groups = new Map<string, SourceAccountAllocationReadModel>();
  for (const holding of holdings) {
    const current = groups.get(holding.sourceAccountId) ?? {
      sourceAccountId: holding.sourceAccountId,
      label: holding.source,
      valueEur: 0,
      sharePercent: 0,
      holdingCount: 0,
    };
    groups.set(holding.sourceAccountId, {
      ...current,
      valueEur: current.valueEur + holding.eurValue,
      holdingCount: current.holdingCount + 1,
    });
  }
  return [...groups.values()]
    .map((account) => ({
      ...account,
      sharePercent: totalValueEur === 0
        ? 0
        : account.valueEur / totalValueEur * 100,
    }))
    .sort((left, right) =>
      right.valueEur - left.valueEur ||
      left.sourceAccountId.localeCompare(right.sourceAccountId)
    );
}

export function createPortfolioValuationTimeline(
  input: PortfolioValuationTimelineInput,
): PortfolioOverviewReadModel {
  const state = buildPortfolioState({
    openingSnapshots: input.snapshots,
    events: input.events,
  });
  const eurPerUnit = eurPerUnitAt(input.fxObservations, input.asOf);
  const fxAsOf = input.fxObservations
    .map((observation) => observation.asOf)
    .sort()
    .at(-1) ?? input.asOf;
  const snapshotTimes = Object.fromEntries(
    input.snapshots.map((snapshot) => [snapshot.sourceAccountId, snapshot.asOf]),
  );
  const current = createCurrentPortfolioValuationReadModel({
    state,
    snapshots: input.snapshots,
    asOf: input.asOf,
    snapshotTimes,
    marketPrices: input.marketPrices,
    marketRefreshHistory: input.marketRefreshHistory,
    eurPerUnit,
    fxAsOf,
    accountLabels: input.accountLabels,
  });
  const portfolioHistory = createPortfolioHistoryReadModel({
    snapshots: input.snapshots,
    events: input.events,
    marketPrices: input.marketPrices,
    fxObservations: input.fxObservations,
    asOf: input.asOf,
    eurPerUnit,
    fxAsOf,
  });
  const holdingHistory = createHoldingHistoryReadModel({
    state,
    snapshots: input.snapshots,
    events: input.events,
    marketPrices: input.marketPrices,
    fxObservations: input.fxObservations,
    asOf: input.asOf,
  });
  const history = combinePortfolioPeriodHistory({
    portfolioHistory,
    holdingHistory,
    currentTotalValueEur: current.totalValueEur,
  });
  const holdings = current.holdings.map((holding) => ({
    ...holding,
    ...(holdingHistory[holding.id]
      ? { history: holdingHistory[holding.id] }
      : {}),
  }));
  const fxOverview = createEurCnyOverview(input.fxObservations, input.asOf);

  return {
    ...current,
    holdings,
    accountAllocation: createSourceAccountAllocation(
      holdings,
      current.totalValueEur,
    ),
    history,
    ...(fxOverview ? { fxOverview } : {}),
  };
}
