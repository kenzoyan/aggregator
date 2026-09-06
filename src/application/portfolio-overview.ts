import { createEurCnyOverview, eurPerUnitAt } from "@/application/fx-history";
import { createHoldingHistoryReadModel } from "@/application/holding-history";
import {
  createDashboardReadModel,
  createPortfolioHistoryReadModel,
} from "@/application/portfolio-dashboard";
import { createPortfolioInsightsReadModel } from "@/application/portfolio-insights";
import { combinePortfolioPeriodHistory } from "@/application/portfolio-periods";
import type {
  HoldingReadModel,
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
  SourceAccountAllocationReadModel,
} from "@/application/portfolio-read-model";
import type {
  FxRateObservation,
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type {
  OpeningSnapshotInput,
  PortfolioEventInput,
  PortfolioState,
} from "@/domain/portfolio/types";

export interface PortfolioOverviewInput {
  state: PortfolioState;
  snapshots: OpeningSnapshotInput[];
  events: PortfolioEventInput[];
  marketPrices: MarketPriceObservation[];
  fxObservations: FxRateObservation[];
  latestMarketRefresh?: MarketRefreshRecord;
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

export function createPortfolioOverviewReadModel(
  input: PortfolioOverviewInput,
): PortfolioOverviewReadModel & { insights: PortfolioInsightsReadModel } {
  const eurPerUnit = eurPerUnitAt(input.fxObservations, input.asOf);
  const fxAsOf = input.fxObservations
    .map((observation) => observation.asOf)
    .sort()
    .at(-1) ?? input.asOf;
  const snapshotTimes = Object.fromEntries(
    input.snapshots.map((snapshot) => [snapshot.sourceAccountId, snapshot.asOf]),
  );
  const portfolio = createDashboardReadModel({
    state: input.state,
    snapshots: input.snapshots,
    asOf: input.asOf,
    snapshotTimes,
    marketPrices: input.marketPrices,
    latestMarketRefresh: input.latestMarketRefresh,
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
    state: input.state,
    snapshots: input.snapshots,
    events: input.events,
    marketPrices: input.marketPrices,
    fxObservations: input.fxObservations,
    asOf: input.asOf,
  });
  const history = combinePortfolioPeriodHistory({
    portfolioHistory,
    holdingHistory,
    currentTotalValueEur: portfolio.totalValueEur,
  });
  const holdings = portfolio.holdings.map((holding) => ({
    ...holding,
    ...(holdingHistory[holding.id]
      ? { history: holdingHistory[holding.id] }
      : {}),
  }));
  const fxOverview = createEurCnyOverview(input.fxObservations, input.asOf);
  const portfolioWithHistory: PortfolioOverviewReadModel = {
    ...portfolio,
    holdings,
    accountAllocation: createSourceAccountAllocation(
      holdings,
      portfolio.totalValueEur,
    ),
    history,
    ...(fxOverview ? { fxOverview } : {}),
  };
  return {
    ...portfolioWithHistory,
    insights: createPortfolioInsightsReadModel({
      portfolio: portfolioWithHistory,
      asOf: input.asOf,
    }),
  };
}
