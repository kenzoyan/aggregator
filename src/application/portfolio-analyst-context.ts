import type {
  HoldingReadModel,
  MarketRefreshRunReadModel,
  Period,
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";
import type { MarketRefreshFailureCategory } from "@/domain/market-data";

export const ANALYST_CONTEXT_MAX_BYTES = 32 * 1024;
const MAX_PERIOD_DRIVER_HOLDINGS = 5;
const MAX_NAMED_DATA_QUALITY_GAPS = 5;
const MAX_REFRESH_RESULTS = 3;

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
    };

interface PortfolioTotalFact {
  key: "portfolio.total";
  kind: "portfolio-total";
  label: "Portfolio total";
  valueEur: number;
  provenance: "portfolio-valuation";
}

interface PeriodPerformanceFact {
  key: "period.total";
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

interface HoldingDriverFact {
  key: `driver.${number}`;
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

interface QualitySummaryFact {
  key: "quality.summary";
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

interface DataGapFact {
  key: `quality.gap.${number}`;
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

interface RefreshResultFact {
  key: `refresh.${number}`;
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

export type AnalystEvidenceFact =
  | PortfolioTotalFact
  | PeriodPerformanceFact
  | HoldingDriverFact
  | QualitySummaryFact
  | DataGapFact
  | RefreshResultFact;

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
}

export class PortfolioAnalystContextError extends Error {
  constructor(readonly code: "context-too-large") {
    super("Portfolio analyst context exceeds the local size limit");
    this.name = "PortfolioAnalystContextError";
  }
}

interface RankedGap extends Omit<DataGapFact, "key"> {
  rank: number;
  stableOrder: string;
}

function portfolioShare(value: number, total: number): number {
  return total === 0 ? 0 : value / total * 100;
}

function analystFailureCategory(
  category: MarketRefreshFailureCategory,
): RefreshFailureCategory {
  switch (category) {
    case "configuration":
    case "timeout":
    case "authentication":
    case "rate-limit":
      return category;
    case "legacy-redacted":
      return "earlier-details-removed";
    default:
      return "provider-error";
  }
}

function refreshFacts(
  history: readonly MarketRefreshRunReadModel[],
): RefreshResultFact[] {
  return [...history]
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, MAX_REFRESH_RESULTS)
    .map((refresh, index) => ({
      key: `refresh.${index + 1}`,
      kind: "refresh-result",
      label: "Market refresh result",
      mode: refresh.mode,
      provider: refresh.provider,
      completedAt: refresh.completedAt,
      updated: refresh.updated,
      unchanged: refresh.unchanged,
      failed: refresh.failed,
      failureCategories: [...new Set(refresh.failures.map((failure) =>
        analystFailureCategory(failure.category)
      ))].sort(),
      provenance: "market-refresh",
    }));
}

function displayFields(
  holding: HoldingReadModel,
  includeHoldingNames: boolean,
): Pick<DataGapFact, "name" | "currentValueEur"> {
  return {
    ...(includeHoldingNames && holding.analystDisplayName
      ? { name: holding.analystDisplayName }
      : {}),
    currentValueEur: holding.eurValue,
  };
}

function dataQualityGaps(
  portfolio: AnalystPortfolioReadModel,
  includeHoldingNames: boolean,
): RankedGap[] {
  const gaps: RankedGap[] = [];

  for (const missing of portfolio.missingInputs) {
    gaps.push({
      kind: "data-gap",
      label: "Data gap",
      category: missing.kind === "fx" ? "missing-fx" : "missing-price",
      impact: "valuation-blocked",
      currency: missing.currency,
      provenance: "portfolio-valuation",
      rank: missing.kind === "fx" ? 0 : 1,
      stableOrder: `${missing.kind}:${missing.currency}`,
      ...(includeHoldingNames && missing.analystDisplayName
        ? { name: missing.analystDisplayName }
        : {}),
    });
  }

  for (const period of ["today", "week", "month"] as const) {
    const performance = portfolio.history[period];
    if (!performance.available) {
      gaps.push({
        kind: "data-gap",
        label: "Data gap",
        category: "performance-baseline-missing",
        impact: "performance-limited",
        period,
        provenance: "portfolio-performance",
        rank: 2,
        stableOrder: `period:${period}`,
      });
    } else if (performance.coverage === "partial") {
      gaps.push({
        kind: "data-gap",
        label: "Data gap",
        category: "partial-period-coverage",
        impact: "performance-limited",
        period,
        ...(performance.baselineAsOf ? { asOf: performance.baselineAsOf } : {}),
        provenance: "portfolio-performance",
        rank: 2,
        stableOrder: `partial:${period}`,
      });
    }
  }

  for (const holding of portfolio.holdings) {
    if (holding.freshness === "awaiting-nav") {
      gaps.push({
        kind: "data-gap",
        label: "Data gap",
        category: "awaiting-nav",
        impact: "performance-limited",
        ...displayFields(holding, includeHoldingNames),
        asOf: holding.asOf,
        provenance: "market-data",
        rank: 3,
        stableOrder: `${holding.name}:${holding.asOf}`,
      });
    } else if (holding.freshness === "stale") {
      gaps.push({
        kind: "data-gap",
        label: "Data gap",
        category: "stale-market-data",
        impact: "freshness-limited",
        ...displayFields(holding, includeHoldingNames),
        asOf: holding.asOf,
        provenance: "market-data",
        rank: 4,
        stableOrder: `${holding.name}:${holding.asOf}`,
      });
    }
  }

  const latestRefresh = [...(portfolio.marketData.refreshHistory ?? [])]
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .at(0);
  if (latestRefresh && latestRefresh.failed > 0) {
    const categories = latestRefresh.failures.map((failure) =>
      analystFailureCategory(failure.category)
    );
    const configuration = categories.includes("configuration");
    gaps.push({
      kind: "data-gap",
      label: "Data gap",
      category: configuration ? "refresh-configuration" : "refresh-provider-failure",
      impact: "freshness-limited",
      provenance: "market-refresh",
      rank: configuration ? 5 : 6,
      stableOrder: `${latestRefresh.completedAt}:${latestRefresh.provider}`,
    });
  }

  return gaps.sort((left, right) =>
    left.rank - right.rank ||
    (right.currentValueEur ?? 0) - (left.currentValueEur ?? 0) ||
    left.stableOrder.localeCompare(right.stableOrder)
  );
}

function qualitySummary(portfolio: AnalystPortfolioReadModel): QualitySummaryFact {
  const quality = portfolio.insights.dataQuality;
  return {
    key: "quality.summary",
    kind: "quality-summary",
    label: "Data quality summary",
    valuedHoldingCount: quality.valuedHoldingCount,
    freshCount: quality.freshCount,
    manualCount: quality.manualCount,
    staleCount: quality.staleCount,
    awaitingNavCount: quality.awaitingNavCount,
    missingInputCount: quality.missingInputCount,
    availablePerformancePeriods: quality.availablePerformancePeriods,
    provenance: "portfolio-read-model",
  };
}

function allowedActionFor(gap: DataGapFact | undefined): FactualUpdate[] {
  if (!gap) return [];
  switch (gap.category) {
    case "missing-fx":
      return [{
        kind: "refresh-fx",
        currency: gap.currency ?? "unknown",
        reasonEvidenceKey: gap.key,
      }];
    case "refresh-configuration":
      return [{ kind: "configure-danske-route", reasonEvidenceKey: gap.key }];
    case "refresh-provider-failure":
      return [{ kind: "retry-market-data-refresh", reasonEvidenceKey: gap.key }];
    default:
      return [{ kind: "record-dated-market-data", reasonEvidenceKey: gap.key }];
  }
}

function baseContext(
  portfolio: AnalystPortfolioReadModel,
  request: PortfolioAnalystRequest,
): Omit<PortfolioAnalystContextV1, "facts" | "limitations" | "allowedActions"> {
  return {
    version: "portfolio-analyst-context.v1",
    job: request.job,
    language: request.language,
    factsAsOf: portfolio.insights.asOf,
    scope: request.job === "explain-period-drivers"
      ? { period: request.period }
      : {},
    definitions: {
      baseCurrency: "EUR",
      holdingCurrencyMeaning: "instrument-quoted-currency",
      portfolioActivityMeaning: "estimated-unexplained-value-movement",
    },
  };
}

function periodContext(
  portfolio: AnalystPortfolioReadModel,
  request: Extract<PortfolioAnalystRequest, { job: "explain-period-drivers" }>,
): PortfolioAnalystContextV1 {
  const period = portfolio.history[request.period];
  const facts: AnalystEvidenceFact[] = [{
    key: "portfolio.total",
    kind: "portfolio-total",
    label: "Portfolio total",
    valueEur: portfolio.totalValueEur,
    provenance: "portfolio-valuation",
  }];
  const limitations: AnalystLimitation[] = [];

  if (!period.available) {
    const gap: DataGapFact = {
      key: "quality.gap.1",
      kind: "data-gap",
      label: "Data gap",
      category: "performance-baseline-missing",
      impact: "performance-limited",
      provenance: "portfolio-performance",
    };
    facts.push(gap);
    limitations.push({ code: "period-unavailable", evidenceKey: gap.key });
    return {
      ...baseContext(portfolio, request),
      facts,
      limitations,
      allowedActions: allowedActionFor(gap),
    };
  }

  const periodFact: PeriodPerformanceFact = {
    key: "period.total",
    kind: "period-performance",
    label: "Period performance",
    period: request.period,
    coverage: period.coverage ?? "full",
    changeEur: period.change,
    percent: period.percent,
    priceEffectEur: period.priceChange ?? 0,
    fxEffectEur: period.fxChange ?? 0,
    ...(period.baselineAsOf ? { baselineAsOf: period.baselineAsOf } : {}),
    ...(period.currentAsOf ? { currentAsOf: period.currentAsOf } : {}),
    ...(period.valueHistory?.activityAvailable
      ? { estimatedPortfolioActivityEur: period.valueHistory.portfolioActivity }
      : {}),
    provenance: "portfolio-performance",
  };
  facts.push(periodFact);

  const drivers = portfolio.holdings
    .filter((holding) => holding.history?.[request.period].available)
    .sort((left, right) => {
      const difference = Math.abs(right.history![request.period].change) -
        Math.abs(left.history![request.period].change);
      return difference || left.name.localeCompare(right.name);
    })
    .slice(0, MAX_PERIOD_DRIVER_HOLDINGS);
  facts.push(...drivers.map((holding, index): HoldingDriverFact => {
    const contribution = holding.history![request.period];
    return {
      key: `driver.${index + 1}`,
      kind: "holding-driver",
      label: "Holding contribution",
      ...(request.includeHoldingNames && holding.analystDisplayName
        ? { name: holding.analystDisplayName }
        : {}),
      currentValueEur: holding.eurValue,
      portfolioSharePercent: portfolioShare(holding.eurValue, portfolio.totalValueEur),
      contributionEur: contribution.change,
      percent: contribution.percent,
      freshness: holding.freshness,
      ...(contribution.baselineAsOf ? { baselineAsOf: contribution.baselineAsOf } : {}),
      ...(contribution.currentAsOf ? { currentAsOf: contribution.currentAsOf } : {}),
      provenance: "holding-performance",
    };
  }));

  if (period.coverage === "partial") {
    const gap: DataGapFact = {
      key: "quality.gap.1",
      kind: "data-gap",
      label: "Data gap",
      category: "partial-period-coverage",
      impact: "performance-limited",
      ...(period.baselineAsOf ? { asOf: period.baselineAsOf } : {}),
      provenance: "portfolio-performance",
    };
    facts.push(gap);
    limitations.push({ code: "partial-period-coverage", evidenceKey: gap.key });
  }
  if (
    period.valueHistory?.activityAvailable &&
    period.valueHistory.portfolioActivity !== 0
  ) {
    limitations.push({
      code: "portfolio-activity-cause-unknown",
      evidenceKey: periodFact.key,
    });
  }

  const firstGap = facts.find((fact): fact is DataGapFact => fact.kind === "data-gap");
  return {
    ...baseContext(portfolio, request),
    facts,
    limitations,
    allowedActions: allowedActionFor(firstGap),
  };
}

function qualityContext(
  portfolio: AnalystPortfolioReadModel,
  request: Extract<PortfolioAnalystRequest, { job: "diagnose-data-quality" }>,
): PortfolioAnalystContextV1 {
  let includedNameCount = 0;
  const gaps = dataQualityGaps(portfolio, request.includeHoldingNames)
    .map(({ rank: _rank, stableOrder: _stableOrder, ...gap }, index): DataGapFact => {
      const includeName = gap.name !== undefined && includedNameCount < MAX_NAMED_DATA_QUALITY_GAPS;
      if (includeName) includedNameCount += 1;
      const { name: _name, ...unnamedGap } = gap;
      return {
        ...unnamedGap,
        ...(includeName ? { name: gap.name } : {}),
        key: `quality.gap.${index + 1}`,
      };
    });
  return {
    ...baseContext(portfolio, request),
    facts: [
      qualitySummary(portfolio),
      ...gaps,
      ...refreshFacts(portfolio.marketData.refreshHistory ?? []),
    ],
    limitations: [],
    allowedActions: allowedActionFor(gaps[0]),
  };
}

function assertContextSize(context: PortfolioAnalystContextV1): void {
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > ANALYST_CONTEXT_MAX_BYTES) {
    throw new PortfolioAnalystContextError("context-too-large");
  }
}

export function createPortfolioAnalystContext(input: {
  portfolio: AnalystPortfolioReadModel;
  request: PortfolioAnalystRequest;
}): PortfolioAnalystContextV1 {
  const context = input.request.job === "explain-period-drivers"
    ? periodContext(input.portfolio, input.request)
    : qualityContext(input.portfolio, input.request);
  assertContextSize(context);
  return context;
}

export function createPortfolioAnalystTools(
  portfolio: AnalystPortfolioReadModel,
): PortfolioAnalystTools {
  return {
    readPeriodDrivers(input: {
      period: Period;
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }): AnalystEvidenceBundleV1 {
      return createPortfolioAnalystContext({
        portfolio,
        request: { job: "explain-period-drivers", ...input },
      });
    },
    readDataQuality(input: {
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }): AnalystEvidenceBundleV1 {
      return createPortfolioAnalystContext({
        portfolio,
        request: { job: "diagnose-data-quality", ...input },
      });
    },
  };
}
