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
  mode: "manual" | "automatic" | "unknown";
  provider: string;
  completedAt: string;
  updated: number;
  unchanged: number;
  failed: number;
  failures: readonly MarketRefreshFailure[];
}

export interface MarketRefreshFailure {
  instrumentCode: string;
  category: MarketRefreshFailureCategory;
  message: string;
}

export type MarketRefreshFailureCategory =
  | "configuration"
  | "authentication"
  | "rate-limit"
  | "timeout"
  | "unexpected-currency"
  | "no-data"
  | "safety-limit"
  | "provider-error"
  | "legacy-redacted";

export interface FundNavProvider {
  readonly id: string;
  supportsInstrumentCode?(instrumentCode: string): boolean;
  fetchSince(
    instrumentCode: string,
    sinceDate: string,
  ): Promise<FundNavQuote[]>;
}
