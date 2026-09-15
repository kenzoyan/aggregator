import type {
  HoldingReadModel,
  MarketRefreshRunReadModel,
  Period,
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";

export const ANALYST_CONTEXT_MAX_BYTES = 32 * 1024;

export type AnalystPortfolioReadModel = PortfolioOverviewReadModel & {
  insights: PortfolioInsightsReadModel;
};

export type PortfolioAnalystLanguage = "en" | "zh-CN";

export type PortfolioAnalystRequest =
  | {
      job: "explain-period-drivers";
      period: Period;
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }
  | {
      job: "diagnose-data-quality";
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }
  | {
      job: "summarize-portfolio";
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    };

export interface PortfolioTotalFact {
  key: string;
  kind: "portfolio-total";
  label: "Portfolio total";
  valueEur: number;
  provenance: "portfolio-valuation";
}

export interface PeriodPerformanceFact {
  key: string;
  kind: "period-performance";
  label: "Period performance";
  period: Period;
  coverage: "full" | "partial";
  changeEur: number;
  percent: number;
  priceEffectEur: number;
  fxEffectEur: number;
  baselineAsOf?: string;
  currentAsOf?: string;
  estimatedPortfolioActivityEur?: number;
  provenance: "portfolio-performance";
}

export interface HoldingDriverFact {
  key: string;
  kind: "holding-driver";
  label: "Holding contribution";
  name?: string;
  currentValueEur: number;
  portfolioSharePercent: number;
  contributionEur: number;
  percent: number;
  freshness: HoldingReadModel["freshness"];
  baselineAsOf?: string;
  currentAsOf?: string;
  provenance: "holding-performance";
}

export interface QualitySummaryFact {
  key: string;
  kind: "quality-summary";
  label: "Data quality summary";
  valuedHoldingCount: number;
  freshCount: number;
  manualCount: number;
  staleCount: number;
  awaitingNavCount: number;
  missingInputCount: number;
  availablePerformancePeriods: Period[];
  provenance: "portfolio-read-model";
}

export type DataGapCategory =
  | "missing-fx"
  | "missing-price"
  | "performance-baseline-missing"
  | "partial-period-coverage"
  | "awaiting-nav"
  | "stale-market-data"
  | "refresh-configuration"
  | "refresh-provider-failure";

export interface DataGapFact {
  key: string;
  kind: "data-gap";
  label: "Data gap";
  category: DataGapCategory;
  impact: "valuation-blocked" | "performance-limited" | "freshness-limited";
  name?: string;
  currentValueEur?: number;
  currency?: string;
  period?: Period;
  asOf?: string;
  provenance:
    | "portfolio-valuation"
    | "portfolio-performance"
    | "market-data"
    | "market-refresh";
}

export type RefreshFailureCategory =
  | "configuration"
  | "timeout"
  | "authentication"
  | "rate-limit"
  | "earlier-details-removed"
  | "provider-error";

export interface RefreshResultFact {
  key: string;
  kind: "refresh-result";
  label: "Market refresh result";
  mode: MarketRefreshRunReadModel["mode"];
  provider: string;
  completedAt: string;
  updated: number;
  unchanged: number;
  failed: number;
  failureCategories: RefreshFailureCategory[];
  provenance: "market-refresh";
}

export interface PortfolioOverviewSummaryFact {
  key: string;
  kind: "portfolio-overview-summary";
  label: "Portfolio overview";
  totalValueEur: number;
  investmentPositionCount: number;
  sourceAccountCount: number;
  topHoldingName?: string;
  topHoldingValueEur?: number;
  topHoldingSharePercent?: number;
  topThreeSharePercent: number;
  provenance: "portfolio-insights";
}

export interface PortfolioAllocationFact {
  key: string;
  kind: "portfolio-allocation";
  label: "Portfolio allocation";
  dimension: "holding-currency" | "asset-category" | "source-account";
  rank: number;
  group?: string;
  valueEur: number;
  sharePercent: number;
  holdingCount: number;
  provenance: "portfolio-insights" | "portfolio-valuation";
}

export interface PortfolioMoverFact {
  key: string;
  kind: "portfolio-mover";
  label: "Recent portfolio mover";
  direction: "strongest" | "weakest";
  period: "today";
  name?: string;
  changeEur: number;
  percent: number;
  provenance: "holding-performance";
}

export type AnalystEvidenceFact =
  | PortfolioTotalFact
  | PeriodPerformanceFact
  | HoldingDriverFact
  | QualitySummaryFact
  | DataGapFact
  | RefreshResultFact
  | PortfolioOverviewSummaryFact
  | PortfolioAllocationFact
  | PortfolioMoverFact;

export const analystLimitationCodes = [
  "period-unavailable",
  "partial-period-coverage",
  "portfolio-activity-cause-unknown",
] as const;

export interface AnalystLimitation {
  code: typeof analystLimitationCodes[number];
  evidenceKey: string;
}

export const factualUpdateKinds = [
  "refresh-fx",
  "record-dated-market-data",
  "configure-danske-route",
  "retry-market-data-refresh",
] as const;

export type FactualUpdate =
  | { kind: "refresh-fx"; currency: string; reasonEvidenceKey: string }
  | { kind: "record-dated-market-data"; reasonEvidenceKey: string }
  | { kind: "configure-danske-route"; reasonEvidenceKey: string }
  | { kind: "retry-market-data-refresh"; reasonEvidenceKey: string };

export interface PortfolioAnalystContextV1 {
  version: "portfolio-analyst-context.v1";
  job: PortfolioAnalystRequest["job"];
  language: PortfolioAnalystLanguage;
  factsAsOf: string;
  scope: { period?: Period };
  definitions: {
    baseCurrency: "EUR";
    holdingCurrencyMeaning: "instrument-quoted-currency";
    portfolioActivityMeaning: "estimated-unexplained-value-movement";
  };
  facts: AnalystEvidenceFact[];
  limitations: AnalystLimitation[];
  allowedActions: FactualUpdate[];
}

export type AnalystEvidenceBundleV1 = PortfolioAnalystContextV1;

export interface PortfolioAnalystTools {
  readPeriodDrivers(input: {
    period: Period;
    language: PortfolioAnalystLanguage;
    includeHoldingNames: boolean;
  }): AnalystEvidenceBundleV1;
  readDataQuality(input: {
    language: PortfolioAnalystLanguage;
    includeHoldingNames: boolean;
  }): AnalystEvidenceBundleV1;
  readPortfolioOverview(input: {
    language: PortfolioAnalystLanguage;
    includeHoldingNames: boolean;
  }): AnalystEvidenceBundleV1;
}

export class PortfolioAnalystContextError extends Error {
  constructor(readonly code: "context-too-large") {
    super("Portfolio analyst context exceeds the local size limit");
    this.name = "PortfolioAnalystContextError";
  }
}
