import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";

export const narrativeFactKeys = [
  "portfolio-as-of",
  "composition",
  "holding-currency",
  "asset-category",
  "performance-today",
  "performance-week",
  "performance-month",
  "recent-movers",
  "data-quality",
] as const;

export type NarrativeFactKey = typeof narrativeFactKeys[number];

export interface PortfolioNarrativeFact {
  key: NarrativeFactKey;
  label: string;
  value: string;
}

const periodLabels = {
  today: "Today performance",
  week: "7-day performance",
  month: "30-day performance",
} as const;

function fixed(value: number): string {
  return value.toFixed(2);
}

function signed(value: number, suffix = ""): string {
  return `${value >= 0 ? "+" : "−"}${fixed(Math.abs(value))}${suffix}`;
}

function signedEur(value: number): string {
  return `${value >= 0 ? "+" : "−"}€${fixed(Math.abs(value))}`;
}

function performanceValue(
  performance: PortfolioInsightsReadModel["performance"]["today"],
): string {
  if (!performance.available) return "Unavailable";
  return [
    `${signedEur(performance.changeEur)} (${signed(performance.percent, "%")})`,
    `price ${signedEur(performance.priceChangeEur)}`,
    `FX ${signedEur(performance.fxChangeEur)}`,
  ].join("; ");
}

export function createPortfolioNarrativeCloudFacts(
  insights: PortfolioInsightsReadModel,
) {
  return {
    asOf: {
      factKey: "portfolio-as-of" as const,
      value: insights.asOf,
    },
    composition: {
      factKey: "composition" as const,
      investmentPositionCount: insights.summary.investmentPositionCount,
      sourceAccountCount: insights.summary.sourceAccountCount,
      topHolding: insights.summary.topHolding && {
        name: insights.summary.topHolding.name,
        valueEur: insights.summary.topHolding.valueEur,
        sharePercent: insights.summary.topHolding.sharePercent,
      },
      topThreeSharePercent: insights.summary.topThreeSharePercent,
    },
    holdingCurrencyAllocation: {
      factKey: "holding-currency" as const,
      values: insights.holdingCurrencyAllocation,
    },
    categoryAllocation: {
      factKey: "asset-category" as const,
      values: insights.categoryAllocation,
    },
    performance: {
      today: {
        factKey: "performance-today" as const,
        ...insights.performance.today,
      },
      week: {
        factKey: "performance-week" as const,
        ...insights.performance.week,
      },
      month: {
        factKey: "performance-month" as const,
        ...insights.performance.month,
      },
    },
    recentMovers: insights.recentMovers && {
      factKey: "recent-movers" as const,
      period: insights.recentMovers.period,
      strongest: {
        name: insights.recentMovers.strongest.name,
        changeEur: insights.recentMovers.strongest.changeEur,
        percent: insights.recentMovers.strongest.percent,
      },
      weakest: {
        name: insights.recentMovers.weakest.name,
        changeEur: insights.recentMovers.weakest.changeEur,
        percent: insights.recentMovers.weakest.percent,
      },
    },
    dataQuality: {
      factKey: "data-quality" as const,
      ...insights.dataQuality,
    },
  };
}

export function createPortfolioNarrativeFacts(
  insights: PortfolioInsightsReadModel,
): PortfolioNarrativeFact[] {
  const topHolding = insights.summary.topHolding;
  const composition = [
    `${insights.summary.investmentPositionCount} investments across ${insights.summary.sourceAccountCount} ${insights.summary.sourceAccountCount === 1 ? "account" : "accounts"}`,
    ...(topHolding
      ? [`largest holding ${topHolding.name} at ${topHolding.sharePercent.toFixed(1)}%`]
      : []),
    `top three ${insights.summary.topThreeSharePercent.toFixed(1)}%`,
  ].join("; ");
  const allocationValue = (
    values: Array<{ sharePercent: number; holdingCount: number }>,
    label: (index: number) => string,
  ) => values.length === 0
    ? "Unavailable"
    : values.map((value, index) =>
        `${label(index)} ${value.sharePercent.toFixed(1)}% (${value.holdingCount})`
      ).join("; ");
  const movers = insights.recentMovers;

  return [
    {
      key: "portfolio-as-of",
      label: "Portfolio facts as of",
      value: insights.asOf,
    },
    { key: "composition", label: "Portfolio composition", value: composition },
    {
      key: "holding-currency",
      label: "Holding currency allocation",
      value: allocationValue(
        insights.holdingCurrencyAllocation,
        (index) => insights.holdingCurrencyAllocation[index]!.currency,
      ),
    },
    {
      key: "asset-category",
      label: "Asset category allocation",
      value: allocationValue(
        insights.categoryAllocation,
        (index) => insights.categoryAllocation[index]!.category,
      ),
    },
    ...(["today", "week", "month"] as const).map((period) => ({
      key: `performance-${period}` as NarrativeFactKey,
      label: periodLabels[period],
      value: performanceValue(insights.performance[period]),
    })),
    {
      key: "recent-movers",
      label: "Latest available holding contributors",
      value: movers
        ? `strongest ${movers.strongest.name} ${signedEur(movers.strongest.changeEur)}; weakest ${movers.weakest.name} ${signedEur(movers.weakest.changeEur)}`
        : "Unavailable",
    },
    {
      key: "data-quality",
      label: "Data coverage",
      value: [
        `${insights.dataQuality.valuedHoldingCount} valued`,
        `${insights.dataQuality.freshCount} fresh`,
        `${insights.dataQuality.manualCount} manual`,
        `${insights.dataQuality.staleCount} stale`,
        `${insights.dataQuality.awaitingNavCount} awaiting NAV`,
        `${insights.dataQuality.missingInputCount} missing inputs`,
      ].join("; "),
    },
  ];
}

function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createPortfolioNarrativeFingerprint(
  insights: PortfolioInsightsReadModel,
): string {
  const { asOf: _asOf, ...facts } = createPortfolioNarrativeCloudFacts(insights);
  const serialized = JSON.stringify(facts);
  const first = hash32(serialized, 0x811c9dc5).toString(16).padStart(8, "0");
  const second = hash32(serialized, 0x9e3779b1).toString(16).padStart(8, "0");
  return `v1-${first}${second}`;
}

export function portfolioNarrativeFreshness(
  factsFingerprint: string,
  insights: PortfolioInsightsReadModel,
): "current" | "previous" {
  return factsFingerprint === createPortfolioNarrativeFingerprint(insights)
    ? "current"
    : "previous";
}
