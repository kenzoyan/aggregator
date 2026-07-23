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
  priceHistory: HoldingPriceHistoryReadModel[];
}

export interface HoldingTotalReturnReadModel {
  originalAmount: number;
  eurAmount: number;
  percent?: number;
}

export interface HoldingReadModel {
  id: string;
  holdingKey?: {
    sourceAccountId: string;
    instrumentId: string;
  };
  name: string;
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
  priceChange?: number;
  fxChange?: number;
  baselineAsOf?: string;
  currentAsOf?: string;
}

export interface MarketDataStatusReadModel {
  lastRefreshedAt?: string;
  latestResult?: {
    updated: number;
    unchanged: number;
    failed: number;
    failures: Array<{ instrumentCode: string; message: string }>;
  };
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

export interface PortfolioOverviewReadModel {
  holdings: HoldingReadModel[];
  totalValueEur: number;
  fxAsOf: string;
  fxOverview?: FxOverviewReadModel;
  missingInputs: unknown[];
  marketData: MarketDataStatusReadModel;
  history: Record<Period, PeriodPerformanceReadModel>;
}
