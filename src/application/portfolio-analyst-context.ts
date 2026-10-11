import type {
  HoldingReadModel,
  MarketRefreshRunReadModel,
  Period,
} from "@/application/portfolio-read-model";
import {
  type AnalystEvidenceFact,
  type AnalystLimitation,
  type AnalystPortfolioReadModel,
  type DataGapFact,
  type FactualUpdate,
  type HoldingDriverFact,
  type PeriodPerformanceFact,
  type PortfolioAllocationFact,
  type PortfolioAnalystContextV1,
  type PortfolioAnalystRequest,
  type PortfolioMoverFact,
  type PortfolioOverviewSummaryFact,
  type QualitySummaryFact,
  type RefreshFailureCategory,
  type RefreshResultFact,
} from "@/application/portfolio-analyst-contract";
import { assertPortfolioAnalystContextSize } from "@/application/portfolio-analyst-context-size";
import type { MarketRefreshFailureCategory } from "@/domain/market-data";

const MAX_PERIOD_DRIVER_HOLDINGS = 5;
const MAX_NAMED_DATA_QUALITY_GAPS = 5;
const MAX_REFRESH_RESULTS = 3;
const MAX_OVERVIEW_ALLOCATION_GROUPS = 5;

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

  const componentsAvailable = !period.contributions || (period.contributions.length > 0 &&
    period.contributions.every((row) => row.priceChange !== undefined && row.fxChange !== undefined));
  const periodFact: PeriodPerformanceFact = {
    key: "period.total",
    kind: "period-performance",
    label: "Period performance",
    period: request.period,
    coverage: period.coverage ?? "full",
    changeEur: period.change,
    percent: period.percent,
    priceEffectEur: componentsAvailable ? period.contributions?.reduce((sum, row) => sum + row.priceChange!, 0) ?? period.priceChange ?? 0 : undefined,
    fxEffectEur: componentsAvailable ? period.contributions?.reduce((sum, row) => sum + row.fxChange!, 0) ?? period.fxChange ?? 0 : undefined,
    ...(period.contributions ? {
      method: "current-quantity" as const,
      includedHoldingCount: period.contributions.length,
      totalHoldingCount: portfolio.holdings.length + portfolio.missingInputs.length,
      excludedClosedHoldingCount: period.excludedHoldings?.length ?? 0,
      contributionResidualEur: period.change - period.contributions.reduce((sum, row) => sum + row.change, 0),
      decompositionResidualEur: componentsAvailable ? period.change - period.contributions.reduce((sum, row) => sum + row.priceChange! + row.fxChange!, 0) : undefined,
    } : {}),
    ...(period.baselineAsOf ? { baselineAsOf: period.baselineAsOf } : {}),
    ...(period.currentAsOf ? { currentAsOf: period.currentAsOf } : {}),
    ...(period.valueHistory?.activityAvailable
      ? { estimatedPortfolioActivityEur: period.valueHistory.portfolioActivity }
      : {}),
    provenance: "portfolio-performance",
  };
  facts.push(periodFact);

  const contributionById = new Map(period.contributions?.map((row) => [row.holdingId, row]));
  const performanceFor = (holding: HoldingReadModel) => period.contributions
    ? contributionById.get(holding.id) : holding.history?.[request.period];
  const drivers = portfolio.holdings
    .filter((holding) => period.contributions ? contributionById.has(holding.id) : holding.history?.[request.period].available)
    .sort((left, right) => {
      const difference = Math.abs(performanceFor(right)!.change) - Math.abs(performanceFor(left)!.change);
      return difference || left.name.localeCompare(right.name);
    })
    .slice(0, MAX_PERIOD_DRIVER_HOLDINGS);
  facts.push(...drivers.map((holding, index): HoldingDriverFact => {
    const contribution = performanceFor(holding)!;
    return {
      key: `driver.${index + 1}`,
      kind: "holding-driver",
      label: "Holding contribution",
      period: request.period,
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

function overviewContext(
  portfolio: AnalystPortfolioReadModel,
  request: Extract<PortfolioAnalystRequest, { job: "summarize-portfolio" }>,
): PortfolioAnalystContextV1 {
  const insights = portfolio.insights;
  const topHolding = insights.summary.topHolding;
  const summary: PortfolioOverviewSummaryFact = {
    key: "overview.summary",
    kind: "portfolio-overview-summary",
    label: "Portfolio overview",
    totalValueEur: portfolio.totalValueEur,
    investmentPositionCount: insights.summary.investmentPositionCount,
    sourceAccountCount: insights.summary.sourceAccountCount,
    ...(topHolding
      ? {
          ...(request.includeHoldingNames ? { topHoldingName: topHolding.name } : {}),
          topHoldingValueEur: topHolding.valueEur,
          topHoldingSharePercent: topHolding.sharePercent,
        }
      : {}),
    topThreeSharePercent: insights.summary.topThreeSharePercent,
    provenance: "portfolio-insights",
  };
  const currencyAllocation: PortfolioAllocationFact[] = insights.holdingCurrencyAllocation
    .slice(0, MAX_OVERVIEW_ALLOCATION_GROUPS)
    .map((allocation, index) => ({
      key: `overview.currency.${index + 1}`,
      kind: "portfolio-allocation",
      label: "Portfolio allocation",
      dimension: "holding-currency",
      rank: index + 1,
      group: allocation.currency,
      valueEur: allocation.valueEur,
      sharePercent: allocation.sharePercent,
      holdingCount: allocation.holdingCount,
      provenance: "portfolio-insights",
    }));
  const categoryAllocation: PortfolioAllocationFact[] = insights.categoryAllocation
    .slice(0, MAX_OVERVIEW_ALLOCATION_GROUPS)
    .map((allocation, index) => ({
      key: `overview.category.${index + 1}`,
      kind: "portfolio-allocation",
      label: "Portfolio allocation",
      dimension: "asset-category",
      rank: index + 1,
      group: allocation.category,
      valueEur: allocation.valueEur,
      sharePercent: allocation.sharePercent,
      holdingCount: allocation.holdingCount,
      provenance: "portfolio-insights",
    }));
  const accountAllocation: PortfolioAllocationFact[] = portfolio.accountAllocation
    .slice(0, MAX_OVERVIEW_ALLOCATION_GROUPS)
    .map((allocation, index) => ({
      key: `overview.account.${index + 1}`,
      kind: "portfolio-allocation",
      label: "Portfolio allocation",
      dimension: "source-account",
      rank: index + 1,
      valueEur: allocation.valueEur,
      sharePercent: allocation.sharePercent,
      holdingCount: allocation.holdingCount,
      provenance: "portfolio-valuation",
    }));
  const movers: PortfolioMoverFact[] = insights.recentMovers
    ? (["strongest", "weakest"] as const).map((direction) => {
        const mover = insights.recentMovers![direction];
        return {
          key: `overview.mover.${direction}`,
          kind: "portfolio-mover",
          label: "Recent portfolio mover",
          direction,
          period: "today",
          ...(request.includeHoldingNames ? { name: mover.name } : {}),
          changeEur: mover.changeEur,
          percent: mover.percent,
          provenance: "holding-performance",
        };
      })
    : [];
  return {
    ...baseContext(portfolio, request),
    facts: [
      summary,
      ...currencyAllocation,
      ...categoryAllocation,
      ...accountAllocation,
      ...movers,
      qualitySummary(portfolio),
    ],
    limitations: [],
    allowedActions: [],
  };
}

export function createPortfolioAnalystContext(input: {
  portfolio: AnalystPortfolioReadModel;
  request: PortfolioAnalystRequest;
}): PortfolioAnalystContextV1 {
  const context = input.request.job === "explain-period-drivers"
    ? periodContext(input.portfolio, input.request)
    : input.request.job === "diagnose-data-quality"
      ? qualityContext(input.portfolio, input.request)
      : overviewContext(input.portfolio, input.request);
  assertPortfolioAnalystContextSize(context);
  return context;
}
