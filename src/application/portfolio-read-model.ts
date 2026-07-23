export type Period = "today" | "week" | "month";

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
  changeEur: number;
  changePercent: number;
  freshness: "fresh" | "manual" | "stale" | "awaiting-nav";
  asOf: string;
  history?: Record<Period, PeriodPerformanceReadModel>;
}

export interface PeriodPerformanceReadModel {
  available: boolean;
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

export interface PortfolioOverviewReadModel {
  holdings: HoldingReadModel[];
  totalValueEur: number;
  fxAsOf: string;
  missingInputs: unknown[];
  marketData: MarketDataStatusReadModel;
  history: Record<Period, PeriodPerformanceReadModel>;
}
