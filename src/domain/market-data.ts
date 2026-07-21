import type { CurrencyCode } from "@/domain/portfolio/types";

export interface FundNavQuote {
  instrumentCode: string;
  price: string;
  currency: CurrencyCode;
  asOf: string;
  dailyChangePercent?: string;
  source: string;
}

export interface MarketPriceObservation {
  sourceAccountId: string;
  instrumentId: string;
  instrumentCode: string;
  price: string;
  currency: CurrencyCode;
  asOf: string;
  recordedAt: string;
  source: string;
}

export interface FxRateObservation {
  currency: CurrencyCode;
  eurPerUnit: string;
  asOf: string;
  recordedAt: string;
  source: string;
}

export interface MarketRefreshRecord {
  provider: string;
  completedAt: string;
  updated: number;
  unchanged: number;
  failed: number;
  failures: readonly MarketRefreshFailure[];
}

export interface MarketRefreshFailure {
  instrumentCode: string;
  message: string;
}

export interface FundNavProvider {
  readonly id: string;
  fetchSince(
    instrumentCode: string,
    sinceDate: string,
  ): Promise<FundNavQuote[]>;
}
