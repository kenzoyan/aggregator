import { createEurCnyOverview, eurPerUnitAt } from "@/application/fx-history";
import { createHoldingHistoryReadModel } from "@/application/holding-history";
import {
  createDashboardReadModel,
  createPortfolioHistoryReadModel,
} from "@/application/portfolio-dashboard";
import { createPortfolioInsightsReadModel } from "@/application/portfolio-insights";
import { combinePortfolioPeriodHistory } from "@/application/portfolio-periods";
import type {
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
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
