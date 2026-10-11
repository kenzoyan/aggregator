import type { HoldingReadModel, Period, PortfolioOverviewReadModel, PortfolioPeriodContributionReadModel } from "./portfolio-read-model";

export interface PeriodAnalysisHolding {
  id: string;
  sourceAccountId: string;
  account: string;
  name: string;
  symbol?: string;
  currency: string;
  category?: HoldingReadModel["category"];
  status: "included" | "missing-baseline" | "missing-valuation" | "period-unavailable" | "excluded-closed";
  freshness?: HoldingReadModel["freshness"];
  contribution?: PortfolioPeriodContributionReadModel;
  detail?: HoldingReadModel["detail"];
}

export interface PortfolioPeriodAnalysis {
  period: Period;
  factsAsOf: string;
  method: "current-quantity";
  available: boolean;
  coverage: "full" | "partial" | "unavailable";
  baselineAsOf?: string;
  currentAsOf?: string;
  investmentChangeEur?: number;
  percent?: number;
  priceEffectEur?: number;
  fxEffectEur?: number;
  decompositionResidualEur?: number;
  contributionSumEur: number;
  reconciliationResidualEur?: number;
  totalValueChangeEur?: number;
  valueBaselineAsOf?: string;
  valueCurrentAsOf?: string;
  estimatedActivityEur?: number;
  activityCoverage: "available" | "unavailable";
  holdings: PeriodAnalysisHolding[];
  events: NonNullable<PortfolioOverviewReadModel["chartEvents"]>;
}

/** Full local data, independent of the answer's bounded evidence selection. Never refreshes or writes. */
export function createPortfolioPeriodAnalysis(portfolio: PortfolioOverviewReadModel, period: Period, factsAsOf: string): PortfolioPeriodAnalysis {
  const performance = portfolio.history[period];
  const byId = new Map((performance.contributions ?? []).map((row) => [row.holdingId, row]));
  const account = (id: string) => portfolio.accountAllocation.find((item) => item.sourceAccountId === id)?.label ?? id;
  const holdings: PeriodAnalysisHolding[] = portfolio.holdings.map((holding) => ({
    id: holding.id, sourceAccountId: holding.sourceAccountId, account: holding.source,
    name: holding.name, symbol: holding.symbol, currency: holding.currency, category: holding.category, freshness: holding.freshness,
    status: byId.has(holding.id) ? "included" : holding.history?.[period].available ? "period-unavailable" : "missing-baseline",
    contribution: byId.get(holding.id), detail: holding.detail,
  }));
  for (const missing of portfolio.missingInputs) {
    const sourceAccountId = missing.sourceAccountId ?? "";
    const id = missing.instrumentId ? `${sourceAccountId}:${missing.instrumentId}` : `${sourceAccountId}:cash:${missing.currency}`;
    if (holdings.some((holding) => holding.id === id)) continue;
    holdings.push({ id, sourceAccountId, account: account(sourceAccountId),
      name: missing.analystDisplayName ?? missing.instrumentId ?? `${missing.currency} cash`,
      currency: missing.currency, status: "missing-valuation" });
  }
  for (const excluded of performance.excludedHoldings ?? []) {
    holdings.push({ id: excluded.holdingId, sourceAccountId: excluded.sourceAccountId,
      account: account(excluded.sourceAccountId), name: excluded.name, currency: excluded.currency, status: "excluded-closed" });
  }
  const included = holdings.flatMap((holding) => holding.contribution ? [holding.contribution] : []);
  const contributionSumEur = included.reduce((sum, row) => sum + row.change, 0);
  const componentsAvailable = included.length > 0 && included.every((row) => row.priceChange !== undefined && row.fxChange !== undefined);
  const priceEffectEur = componentsAvailable ? included.reduce((sum, row) => sum + row.priceChange!, 0) : undefined;
  const fxEffectEur = componentsAvailable ? included.reduce((sum, row) => sum + row.fxChange!, 0) : undefined;
  // Today uses distinct observation windows; its valueHistory has a different calendar baseline.
  const valueHistory = period !== "today" ? performance.valueHistory : undefined;
  const activityAvailable = Boolean(valueHistory?.available && valueHistory.activityAvailable &&
    valueHistory.baselineAsOf === performance.baselineAsOf && valueHistory.currentAsOf === performance.currentAsOf);
  const hasPartial = holdings.some((holding) => holding.status !== "included") || included.some((row) =>
    performance.baselineAsOf && row.baselineAsOf !== performance.baselineAsOf);
  const dates = included.map((row) => row.baselineAsOf).sort();
  const endDates = included.map((row) => row.currentAsOf).sort();
  const baselineAsOf = performance.baselineAsOf ?? dates[0];
  const currentAsOf = performance.currentAsOf ?? endDates.at(-1);
  return {
    period, factsAsOf, method: "current-quantity", available: performance.available,
    coverage: !performance.available ? "unavailable" : performance.coverage === "partial" || hasPartial ? "partial" : "full",
    baselineAsOf, currentAsOf,
    investmentChangeEur: performance.available ? performance.change : undefined,
    percent: performance.available ? performance.percent : undefined,
    priceEffectEur, fxEffectEur,
    decompositionResidualEur: performance.available && componentsAvailable ? performance.change - priceEffectEur! - fxEffectEur! : undefined,
    contributionSumEur,
    reconciliationResidualEur: performance.available ? performance.change - contributionSumEur : undefined,
    totalValueChangeEur: valueHistory?.available ? valueHistory.change : undefined,
    valueBaselineAsOf: valueHistory?.baselineAsOf,
    valueCurrentAsOf: valueHistory?.currentAsOf,
    estimatedActivityEur: activityAvailable ? valueHistory!.portfolioActivity : undefined,
    activityCoverage: activityAvailable ? "available" : "unavailable",
    holdings,
    events: (portfolio.chartEvents ?? []).filter((event) => baselineAsOf && currentAsOf &&
      event.asOf.slice(0, 10) >= baselineAsOf.slice(0, 10) && event.asOf.slice(0, 10) <= currentAsOf.slice(0, 10)),
  };
}

export type ContributionSort = "impact" | "gainers" | "decliners";
export function sortPeriodContributions(holdings: PeriodAnalysisHolding[], sort: ContributionSort) {
  return [...holdings].sort((left, right) => {
    if (!left.contribution) return right.contribution ? 1 : left.name.localeCompare(right.name);
    if (!right.contribution) return -1;
    const a = left.contribution.change, b = right.contribution.change;
    return (sort === "impact" ? Math.abs(b) - Math.abs(a) : sort === "gainers" ? b - a : a - b) || left.id.localeCompare(right.id);
  });
}
