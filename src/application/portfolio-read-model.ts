import type { MarketRefreshFailure } from "@/domain/market-data";
import type { MissingValuationInput } from "@/domain/portfolio/valuation";

export type Period = "today" | "week" | "month";

export interface HoldingPriceHistoryReadModel {
  price: string;
  currency: string;
  asOf: string;
  source: string;
}

export interface HoldingDetailReadModel {
  quantity: string;
  costBasis: string;
  reportedPriorReturn: string;
  averageCost?: string;
  currentPrice: string;
  currentPriceAsOf: string;
  currentPriceSource: string;
  priceHistory: HoldingPriceHistoryReadModel[];
}

export interface HoldingTotalReturnReadModel {
  originalAmount: number;
  eurAmount: number;
  percent?: number;
}

export interface HoldingReadModel {
  id: string;
  sourceAccountId: string;
  holdingKey?: {
    sourceAccountId: string;
    instrumentId: string;
  };
  name: string;
  analystDisplayName?: string;
  symbol: string;
  source: string;
  category: "Fund" | "Stock" | "Bond" | "ETF" | "Portfolio cash" | "Unclassified";
  currency: string;
  originalValue: string;
  eurValue: number;
  totalReturn?: HoldingTotalReturnReadModel;
  changeEur: number;
  changePercent: number;
  freshness: "fresh" | "manual" | "stale" | "awaiting-nav";
  asOf: string;
  detail?: HoldingDetailReadModel;
  history?: Record<Period, PeriodPerformanceReadModel>;
}

export interface PeriodPerformanceReadModel {
  available: boolean;
  coverage?: "partial";
  change: number;
  percent: number;
  points: number[];
  holdingPoints?: Array<{
    asOf: string;
    priceAsOf: string;
    unitPrice: string;
    valueEur: number;
  }>;
  priceChange?: number;
  fxChange?: number;
  baselineAsOf?: string;
  currentAsOf?: string;
  valuationBaselineAsOf?: string;
  valuationCurrentAsOf?: string;
  dailyChanges?: PortfolioDailyChangeReadModel[];
  valueHistory?: PortfolioValueHistoryReadModel;
  contributions?: PortfolioPeriodContributionReadModel[];
  excludedHoldings?: Array<{ holdingId: string; name: string; sourceAccountId: string; currency: string }>;
}

/** Contribution uses the same current-quantity baseline as the portfolio metric. */
export interface PortfolioPeriodContributionReadModel {
  holdingId: string;
  change: number;
  percent?: number;
  baselineValueEur: number;
  currentValueEur: number;
  baselineAsOf: string;
  currentAsOf: string;
  baselinePriceAsOf?: string;
  currentPriceAsOf?: string;
  priceChange?: number;
  fxChange?: number;
}

export interface PortfolioDailyChangeReadModel {
  asOf: string;
  change: number;
}

export interface PortfolioHoldingActivityReadModel {
  holdingId: string;
  name: string;
  kind: "added" | "increased" | "reduced" | "exited";
  quantityDelta: string;
}

export interface PortfolioValuePointReadModel {
  asOf: string;
  valueEur: number;
  investmentChangeEur: number;
  portfolioActivityEur: number;
  holdingActivities: PortfolioHoldingActivityReadModel[];
}

export interface PortfolioChartEventReadModel {
  id: string;
  asOf: string;
  sourceAccountId: string;
  holdingId?: string;
  account: string;
  kind: "sale" | "withdrawal" | "holding-update";
  label: string;
  amount: { amount: string; currency: string };
  note: string;
}

export interface PortfolioValueHistoryReadModel {
  available: boolean;
  change: number;
  percent: number;
  investmentChange: number;
  portfolioActivity: number;
  activityAvailable: boolean;
  timeline: PortfolioValuePointReadModel[];
  baselineAsOf?: string;
  currentAsOf?: string;
}

export interface MarketDataStatusReadModel {
  lastRefreshedAt?: string;
  latestResult?: {
    updated: number;
    unchanged: number;
    failed: number;
    failures: ReadonlyArray<MarketRefreshFailure>;
  };
  refreshHistory?: MarketRefreshRunReadModel[];
}

export interface MarketRefreshRunReadModel {
  mode: "manual" | "automatic" | "unknown";
  provider: string;
  completedAt: string;
  updated: number;
  unchanged: number;
  failed: number;
  failures: ReadonlyArray<MarketRefreshFailure>;
}

export interface FxOverviewReadModel {
  baseCurrency: "EUR";
  quoteCurrency: "CNY";
  currentRate: number;
  asOf: string;
  history: Array<{
    asOf: string;
    rate: number;
  }>;
}

export interface PortfolioInsightAllocationReadModel {
  valueEur: number;
  sharePercent: number;
  holdingCount: number;
}

export interface SourceAccountAllocationReadModel extends PortfolioInsightAllocationReadModel {
  sourceAccountId: string;
  label: string;
}

export interface PortfolioInsightMoverReadModel {
  id: string;
  name: string;
  changeEur: number;
  percent: number;
}

export interface PortfolioInsightsReadModel {
  asOf: string;
  latestDailyCoverage?: {
    includedCount: number;
    totalCount: number;
    componentsAvailable: boolean;
    comparisons: Array<{ holdingId: string; name: string; baselineAsOf?: string; currentAsOf?: string }>;
  };
  summary: {
    investmentPositionCount: number;
    sourceAccountCount: number;
    topHolding?: {
      id: string;
      name: string;
      valueEur: number;
      sharePercent: number;
    };
    topThreeSharePercent: number;
  };
  holdingCurrencyAllocation: Array<PortfolioInsightAllocationReadModel & {
    currency: string;
  }>;
  categoryAllocation: Array<PortfolioInsightAllocationReadModel & {
    category: HoldingReadModel["category"];
  }>;
  performance: Record<Period, {
    available: boolean;
    changeEur: number;
    percent: number;
    priceChangeEur: number;
    fxChangeEur: number;
  }>;
  recentMovers?: {
    period: "today";
    strongest: PortfolioInsightMoverReadModel;
    weakest: PortfolioInsightMoverReadModel;
  };
  dataQuality: {
    valuedHoldingCount: number;
    freshCount: number;
    manualCount: number;
    staleCount: number;
    awaitingNavCount: number;
    missingInputCount: number;
    availablePerformancePeriods: Period[];
  };
}

export type MissingValuationInputReadModel = MissingValuationInput & {
  analystDisplayName?: string;
};

export interface PortfolioOverviewReadModel {
  chartEvents?: PortfolioChartEventReadModel[];
  holdings: HoldingReadModel[];
  totalValueEur: number;
  accountAllocation: SourceAccountAllocationReadModel[];
  fxAsOf: string;
  fxOverview?: FxOverviewReadModel;
  missingInputs: MissingValuationInputReadModel[];
  marketData: MarketDataStatusReadModel;
  history: Record<Period, PeriodPerformanceReadModel>;
  insights?: PortfolioInsightsReadModel;
}
