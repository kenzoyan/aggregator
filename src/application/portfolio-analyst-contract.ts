import type {
  HoldingReadModel,
  MarketRefreshRunReadModel,
  Period,
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";
import type { SourceAccountDefinition } from "@/domain/source-accounts";

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

export interface SourceAccountFact {
  key: string;
  kind: "source-account";
  label: "Source account";
  accountType: string;
  displayName?: string;
  provider: SourceAccountDefinition["provider"];
  updateMethod: SourceAccountDefinition["updateMethod"];
  provenance: "source-account-registry";
}

export interface AccountHoldingsSummaryFact {
  key: string;
  kind: "account-holdings-summary";
  label: "Account holdings summary";
  requestedAccount: string;
  found: boolean;
  accountType?: string;
  displayName?: string;
  holdingCount: number;
  shownHoldingCount: number;
  totalValueEur: number;
  provenance: "portfolio-read-model";
}

export interface AccountHoldingFact {
  key: string;
  kind: "account-holding";
  label: "Account holding";
  name?: string;
  symbol?: string;
  category: HoldingReadModel["category"];
  quantity?: string;
  unitPrice?: string;
  priceAsOf?: string;
  priceSource?: string;
  currency: string;
  originalValue: string;
  valueEur: number;
  freshness: HoldingReadModel["freshness"];
  asOf: string;
  provenance: "portfolio-read-model";
}

export interface SourceAccountProposalFact {
  key: string;
  kind: "source-account-proposal";
  label: "Source account proposal";
  accountType: string;
  normalizedAccountType: string;
  displayName: string;
  alreadyExists: boolean;
  provenance: "source-account-registry";
}

export interface SourceAccountImportTargetFact {
  key: string;
  kind: "source-account-import-target";
  label: "Source account import target";
  requestedAccountType: string;
  normalizedAccountType: string;
  found: boolean;
  accountType?: string;
  displayName?: string;
  updateMethod?: SourceAccountDefinition["updateMethod"];
  provenance: "source-account-registry";
}

export interface WebResearchSourceFact {
  key: string;
  kind: "web-research-source";
  label: "External source";
  title: string;
  url: string;
  summary: string;
  retrievedAt: string;
  provenance: "openai-web-search";
}

export interface WebResearchStatusFact {
  key: string;
  kind: "web-research-status";
  label: "Web research status";
  state: "no-verified-source" | "unavailable";
  retrievedAt: string;
  provenance: "openai-web-search";
}

export type AnalystEvidenceFact =
  | ActivityHistorySummaryFact
  | RecordedActivityFact
  | PortfolioTotalFact
  | PeriodPerformanceFact
  | HoldingDriverFact
  | QualitySummaryFact
  | DataGapFact
  | RefreshResultFact
  | PortfolioOverviewSummaryFact
  | PortfolioAllocationFact
  | PortfolioMoverFact
  | SourceAccountFact
  | AccountHoldingsSummaryFact
  | AccountHoldingFact
  | SourceAccountProposalFact
  | SourceAccountImportTargetFact
  | WebResearchSourceFact
  | WebResearchStatusFact;

export interface ActivityHistorySummaryFact {
  key: string;
  kind: "activity-history-summary";
  label: "Recorded history summary";
  requestedAccount: string;
  requestedHolding?: string;
  status: "found" | "account-not-found" | "account-ambiguous" | "holding-not-found" | "holding-ambiguous" | "unavailable";
  recordCount: number;
  shownRecordCount: number;
  coverage: "recorded-history-only";
  fromDate?: string;
  toDate?: string;
  provenance: "portfolio-ledger";
}

export interface RecordedActivityFact {
  key: string;
  kind: "recorded-activity";
  label: "Recorded activity";
  activity: "holding-created" | "units-added" | "holding-updated" | "sale" | "cash-withdrawal";
  asOf: string;
  recordedAt?: string;
  voidedAt?: string;
  status: "active" | "undone";
  name?: string;
  symbol?: string;
  quantity?: string;
  currency: string;
  amount: string;
  amountMeaning: "initial-cost" | "cost-change" | "gross-sale-proceeds" | "withdrawal";
  fees?: string;
  netProceeds?: string;
  soldCostBasis?: string;
  realizedResult?: string;
  destination?: "investment-account" | "external-account";
  destinationName?: string;
  destinationKnown?: boolean;
  excludedFromTrackedAssets?: boolean;
  source: "confirmed-holding-update" | "manual-record" | "confirmed-import";
  provenance: "portfolio-ledger";
}

export interface ActivityHistoryToolInput {
  accountType: string;
  fromDate?: string;
  toDate?: string;
  language: PortfolioAnalystLanguage;
  includeHoldingNames: boolean;
}

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
  "create-account",
  "start-account-import",
] as const;

export type FactualUpdate =
  | { kind: "refresh-fx"; currency: string; reasonEvidenceKey: string }
  | { kind: "record-dated-market-data"; reasonEvidenceKey: string }
  | { kind: "configure-danske-route"; reasonEvidenceKey: string }
  | { kind: "retry-market-data-refresh"; reasonEvidenceKey: string }
  | {
      kind: "create-account";
      accountType: string;
      label: string;
      reasonEvidenceKey: string;
    }
  | {
      kind: "start-account-import";
      accountType: string;
      label: string;
      reasonEvidenceKey: string;
    };

export interface PortfolioAnalystContextV1 {
  version: "portfolio-analyst-context.v1";
  job: PortfolioAnalystRequest["job"] | "manage-accounts" | "research-web";
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
  readHoldingHistory(input: ActivityHistoryToolInput & { holding: string }): AnalystEvidenceBundleV1;
  readAccountActivity(input: ActivityHistoryToolInput): AnalystEvidenceBundleV1;
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
  readAccounts(input: {
    language: PortfolioAnalystLanguage;
    includeAccountNames: boolean;
  }): AnalystEvidenceBundleV1;
  readAccountHoldings(input: {
    accountType: string;
    language: PortfolioAnalystLanguage;
    includeHoldingNames: boolean;
  }): AnalystEvidenceBundleV1;
  proposeCreateAccount(input: {
    accountType: string;
    label?: string;
    language: PortfolioAnalystLanguage;
  }): AnalystEvidenceBundleV1;
  prepareAccountImport(input: {
    accountType: string;
    language: PortfolioAnalystLanguage;
    includeAccountNames?: boolean;
  }): AnalystEvidenceBundleV1;
}

export class PortfolioAnalystContextError extends Error {
  constructor(readonly code: "context-too-large") {
    super("Portfolio analyst context exceeds the local size limit");
    this.name = "PortfolioAnalystContextError";
  }
}
