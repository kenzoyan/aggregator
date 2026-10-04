import { describe, expect, it } from "vitest";

import {
  ANALYST_CONTEXT_MAX_BYTES,
  PortfolioAnalystContextError,
} from "@/application/portfolio-analyst-contract";
import {
  createPortfolioAnalystContext,
} from "@/application/portfolio-analyst-context";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import type {
  HoldingReadModel,
  Period,
  PeriodPerformanceReadModel,
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";

const unavailable = (): PeriodPerformanceReadModel => ({
  available: false,
  change: 0,
  percent: 0,
  points: [],
});

function holding(input: {
  id: string;
  name: string;
  value: number;
  freshness?: HoldingReadModel["freshness"];
  changes?: Partial<Record<Period, number>>;
}): HoldingReadModel {
  const history = Object.fromEntries(
    (["today", "week", "month"] as const).map((period) => {
      const change = input.changes?.[period];
      return [period, change === undefined ? unavailable() : {
        available: true,
        change,
        percent: change / Math.max(1, input.value - change) * 100,
        points: [input.value - change, input.value],
        priceChange: change * 0.8,
        fxChange: change * 0.2,
        baselineAsOf: "2026-08-30",
        currentAsOf: "2026-09-06",
      }];
    }),
  ) as Record<Period, PeriodPerformanceReadModel>;

  return {
    id: input.id,
    sourceAccountId: "account-private",
    holdingKey: { sourceAccountId: "account-private", instrumentId: input.id },
    name: input.name,
    analystDisplayName: input.name,
    symbol: `SECRET-${input.id}`,
    source: "Synthetic",
    category: "Fund",
    currency: "EUR",
    originalValue: `EUR ${input.value}`,
    eurValue: input.value,
    changeEur: input.changes?.today ?? 0,
    changePercent: 0,
    freshness: input.freshness ?? "fresh",
    asOf: "2026-09-06",
    detail: {
      quantity: "999 private units",
      costBasis: "EUR 123 private cost",
      reportedPriorReturn: "private return",
      currentPrice: "private price",
      currentPriceAsOf: "2026-09-06",
      currentPriceSource: "synthetic-source",
      priceHistory: [],
    },
    history,
  };
}

function portfolio(
  overrides: Partial<PortfolioOverviewReadModel> = {},
): PortfolioOverviewReadModel & { insights: PortfolioInsightsReadModel } {
  const holdings = [
    holding({ id: "a", name: "Alpha", value: 600, changes: { week: 80 } }),
    holding({ id: "b", name: "Beta", value: 250, changes: { week: 35 } }),
    holding({ id: "c", name: "Gamma", value: 100, changes: { week: -20 } }),
    holding({ id: "d", name: "Delta", value: 50, changes: { week: 5 } }),
  ];
  return {
    holdings,
    totalValueEur: 1_000,
    accountAllocation: [{
      sourceAccountId: "account-private",
      label: "Private Account",
      valueEur: 1_000,
      sharePercent: 100,
      holdingCount: 4,
    }],
    fxAsOf: "2026-09-06",
    missingInputs: [],
    marketData: { refreshHistory: [] },
    history: {
      today: unavailable(),
      week: {
        available: true,
        change: 120,
        percent: 13.64,
        points: [880, 1_000],
        priceChange: 100,
        fxChange: 20,
        baselineAsOf: "2026-08-30",
        currentAsOf: "2026-09-06",
        valueHistory: {
          available: true,
          change: 120,
          percent: 13.64,
          investmentChange: 120,
          portfolioActivity: 0,
          activityAvailable: true,
          timeline: [],
          baselineAsOf: "2026-08-30",
          currentAsOf: "2026-09-06",
        },
      },
      month: unavailable(),
    },
    insights: {
      asOf: "2026-09-06T12:00:00.000Z",
      summary: {
        investmentPositionCount: 4,
        sourceAccountCount: 1,
        topThreeSharePercent: 95,
      },
      holdingCurrencyAllocation: [],
      categoryAllocation: [],
      performance: {
        today: { available: false, changeEur: 0, percent: 0, priceChangeEur: 0, fxChangeEur: 0 },
        week: { available: true, changeEur: 120, percent: 13.64, priceChangeEur: 100, fxChangeEur: 20 },
        month: { available: false, changeEur: 0, percent: 0, priceChangeEur: 0, fxChangeEur: 0 },
      },
      dataQuality: {
        valuedHoldingCount: 4,
        freshCount: 4,
        manualCount: 0,
        staleCount: 0,
        awaitingNavCount: 0,
        missingInputCount: 0,
        availablePerformancePeriods: ["week"],
      },
    },
    ...overrides,
  };
}

function makeEveryPeriodAvailable(
  value: PortfolioOverviewReadModel & { insights: PortfolioInsightsReadModel },
): void {
  for (const period of ["today", "week", "month"] as const) {
    if (!value.history[period].available) {
      value.history[period] = {
        available: true,
        change: 0,
        percent: 0,
        points: [value.totalValueEur, value.totalValueEur],
        priceChange: 0,
        fxChange: 0,
        baselineAsOf: "2026-09-05",
        currentAsOf: "2026-09-06",
      };
    }
  }
}

describe("portfolio analyst context", () => {
  it("builds bounded period evidence and selects the largest relevant contributors", () => {
    const context = createPortfolioAnalystContext({
      portfolio: portfolio(),
      request: {
        job: "explain-period-drivers",
        period: "week",
        language: "zh-CN",
        includeHoldingNames: true,
      },
    });

    expect(context.version).toBe("portfolio-analyst-context.v1");
    expect(context.factsAsOf).toBe("2026-09-06T12:00:00.000Z");
    expect(context.facts.every((fact) => fact.label.length > 0)).toBe(true);
    expect(context.facts.every((fact) => fact.provenance.length > 0)).toBe(true);
    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "period.total",
      kind: "period-performance",
      changeEur: 120,
      priceEffectEur: 100,
      fxEffectEur: 20,
    }));
    expect(context.facts.filter((fact) => fact.kind === "holding-driver"))
      .toEqual([
        expect.objectContaining({ key: "driver.1", name: "Alpha", contributionEur: 80 }),
        expect.objectContaining({ key: "driver.2", name: "Beta", contributionEur: 35 }),
        expect.objectContaining({ key: "driver.3", name: "Gamma", contributionEur: -20 }),
        expect.objectContaining({ key: "driver.4", name: "Delta", contributionEur: 5 }),
      ]);
    expect(JSON.stringify(context)).not.toMatch(/SECRET-|private units|private cost|account-private/);
    expect(Buffer.byteLength(JSON.stringify(context), "utf8"))
      .toBeLessThanOrEqual(ANALYST_CONTEXT_MAX_BYTES);
  });

  it("redacts holding names without losing deterministic evidence keys", () => {
    const context = createPortfolioAnalystContext({
      portfolio: portfolio(),
      request: {
        job: "explain-period-drivers",
        period: "week",
        language: "en",
        includeHoldingNames: false,
      },
    });

    const drivers = context.facts.filter((fact) => fact.kind === "holding-driver");
    expect(drivers.map((driver) => driver.key)).toEqual(["driver.1", "driver.2", "driver.3", "driver.4"]);
    expect(JSON.stringify(drivers)).not.toMatch(/Alpha|Beta|Gamma|Delta/);
  });

  it("keeps each tool response bounded when more relevant holdings are available", () => {
    const value = portfolio();
    value.holdings.push(
      holding({ id: "e", name: "Epsilon", value: 40, changes: { week: 4 } }),
      holding({ id: "f", name: "Zeta", value: 30, changes: { week: 3 } }),
    );

    const context = createPortfolioAnalystTools(value).readPeriodDrivers({
      period: "week",
      language: "en",
      includeHoldingNames: true,
    });
    const drivers = context.facts.filter((fact) => fact.kind === "holding-driver");

    expect(drivers).toHaveLength(5);
    expect(drivers.map((driver) => driver.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Epsilon",
    ]);
    expect(JSON.stringify(context)).not.toContain("Zeta");
  });

  it("declines an unavailable period and exposes one safe factual update", () => {
    const context = createPortfolioAnalystContext({
      portfolio: portfolio(),
      request: {
        job: "explain-period-drivers",
        period: "month",
        language: "en",
        includeHoldingNames: true,
      },
    });

    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "quality.gap.1",
      kind: "data-gap",
      category: "performance-baseline-missing",
    }));
    expect(context.allowedActions).toEqual([{
      kind: "record-dated-market-data",
      reasonEvidenceKey: "quality.gap.1",
    }]);
  });

  it("preserves partial coverage dates and labels unexplained value movement", () => {
    const value = portfolio();
    value.history.month = {
      available: true,
      coverage: "partial",
      change: 500,
      percent: 50,
      points: [1_000, 1_500],
      priceChange: 0,
      fxChange: 0,
      baselineAsOf: "2026-08-25",
      currentAsOf: "2026-09-05",
      valueHistory: {
        available: true,
        change: 500,
        percent: 50,
        investmentChange: 0,
        portfolioActivity: 500,
        activityAvailable: true,
        timeline: [],
        baselineAsOf: "2026-08-25",
        currentAsOf: "2026-09-05",
      },
    };

    const context = createPortfolioAnalystTools(value).readPeriodDrivers({
      period: "month",
      language: "en",
      includeHoldingNames: true,
    });

    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "period.total",
      coverage: "partial",
      baselineAsOf: "2026-08-25",
      currentAsOf: "2026-09-05",
      estimatedPortfolioActivityEur: 500,
    }));
    expect(context.limitations).toEqual(expect.arrayContaining([
      { code: "partial-period-coverage", evidenceKey: "quality.gap.1" },
      { code: "portfolio-activity-cause-unknown", evidenceKey: "period.total" },
    ]));
  });

  it("ranks missing FX first, safely summarizes refreshes and omits raw identifiers", () => {
    const base = portfolio();
    base.holdings[0]!.freshness = "stale";
    base.holdings[1]!.freshness = "awaiting-nav";
    base.missingInputs = [
      { kind: "price", instrumentId: "private-price-id", currency: "EUR" },
      {
        kind: "fx",
        instrumentId: "private-fx-id",
        currency: "CNY",
        analystDisplayName: "Affected Fund",
      },
    ];
    base.marketData.refreshHistory = [
      {
        mode: "automatic",
        provider: "danske-invest",
        completedAt: "2026-09-06T11:00:00.000Z",
        updated: 0,
        unchanged: 0,
        failed: 1,
        failures: [{
          instrumentCode: "PRIVATE-ISIN",
          category: "configuration",
          message: "Automatic NAV route is not configured for this Danske Invest fund",
        }],
      },
      {
        mode: "manual",
        provider: "trading212",
        completedAt: "2026-09-05T11:00:00.000Z",
        updated: 0,
        unchanged: 0,
        failed: 1,
        failures: [{
          instrumentCode: "PRIVATE-SYMBOL",
          category: "timeout",
          message: "Provider request timed out",
        }],
      },
      {
        mode: "unknown",
        provider: "earlier-provider",
        completedAt: "2026-09-04T11:00:00.000Z",
        updated: 0,
        unchanged: 1,
        failed: 0,
        failures: [],
      },
      {
        mode: "manual",
        provider: "too-old",
        completedAt: "2026-09-03T11:00:00.000Z",
        updated: 1,
        unchanged: 0,
        failed: 0,
        failures: [],
      },
    ];

    const context = createPortfolioAnalystTools(base).readDataQuality({
      language: "en",
      includeHoldingNames: true,
    });
    const gaps = context.facts.filter((fact) => fact.kind === "data-gap");
    const refreshes = context.facts.filter((fact) => fact.kind === "refresh-result");

    expect(gaps[0]).toEqual(expect.objectContaining({
      key: "quality.gap.1",
      category: "missing-fx",
      currency: "CNY",
      name: "Affected Fund",
    }));
    expect(refreshes).toHaveLength(3);
    expect(refreshes[0]).toEqual(expect.objectContaining({
      key: "refresh.1",
      failureCategories: ["configuration"],
    }));
    expect(context.allowedActions).toEqual([{
      kind: "refresh-fx",
      currency: "CNY",
      reasonEvidenceKey: "quality.gap.1",
    }]);
    expect(JSON.stringify(context)).not.toMatch(/PRIVATE-|private-fx-id|private-price-id/);
  });

  it("reports no gaps and permits no action when all evidence is current", () => {
    const value = portfolio();
    makeEveryPeriodAvailable(value);
    const context = createPortfolioAnalystTools(value).readDataQuality({
      language: "zh-CN",
      includeHoldingNames: true,
    });

    expect(context.facts.filter((fact) => fact.kind === "data-gap")).toEqual([]);
    expect(context.allowedActions).toEqual([]);
    expect(context.limitations).toEqual([]);
  });

  it("classifies an unconfigured Danske route without exposing its ISIN", () => {
    const value = portfolio();
    makeEveryPeriodAvailable(value);
    value.marketData.refreshHistory = [{
      mode: "automatic",
      provider: "danske-invest",
      completedAt: "2026-09-06T11:00:00.000Z",
      updated: 0,
      unchanged: 0,
      failed: 1,
      failures: [{
        instrumentCode: "FI000000PRIVATE",
        category: "configuration",
        message: "Automatic NAV route is not configured for this Danske Invest fund",
      }],
    }];

    const context = createPortfolioAnalystTools(value).readDataQuality({
      language: "en",
      includeHoldingNames: true,
    });

    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "quality.gap.1",
      category: "refresh-configuration",
    }));
    expect(context.allowedActions).toEqual([{
      kind: "configure-danske-route",
      reasonEvidenceKey: "quality.gap.1",
    }]);
    expect(JSON.stringify(context)).not.toContain("FI000000PRIVATE");
  });

  it("keeps named data-quality gaps within that tool's own bound", () => {
    const value = portfolio();
    value.holdings.push(
      holding({ id: "e", name: "Epsilon", value: 40 }),
      holding({ id: "f", name: "Zeta", value: 30 }),
    );
    makeEveryPeriodAvailable(value);
    for (const item of value.holdings) item.freshness = "stale";

    const context = createPortfolioAnalystTools(value).readDataQuality({
      language: "en",
      includeHoldingNames: true,
    });
    const gaps = context.facts.filter((fact) => fact.kind === "data-gap");
    const namedGaps = gaps.filter((gap) => gap.name !== undefined);

    expect(namedGaps).toHaveLength(5);
    expect(namedGaps.map((gap) => gap.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Epsilon",
    ]);
    expect(JSON.stringify(context)).not.toContain("Zeta");
  });

  it("builds a bounded overview without exposing account identifiers or labels", () => {
    const value = portfolio();
    value.insights.holdingCurrencyAllocation = [{
      currency: "EUR",
      valueEur: 1_000,
      sharePercent: 100,
      holdingCount: 4,
    }];
    value.insights.categoryAllocation = [{
      category: "Fund",
      valueEur: 1_000,
      sharePercent: 100,
      holdingCount: 4,
    }];
    value.insights.summary.topHolding = {
      id: "private-top-id",
      name: "Alpha",
      valueEur: 600,
      sharePercent: 60,
    };
    value.insights.recentMovers = {
      period: "today",
      strongest: { id: "private-a", name: "Alpha", changeEur: 8, percent: 1.2 },
      weakest: { id: "private-c", name: "Gamma", changeEur: -3, percent: -0.8 },
    };

    const context = createPortfolioAnalystTools(value).readPortfolioOverview({
      language: "en",
      includeHoldingNames: true,
    });

    expect(context.job).toBe("summarize-portfolio");
    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "overview.summary",
      kind: "portfolio-overview-summary",
      totalValueEur: 1_000,
      topHoldingName: "Alpha",
      topThreeSharePercent: 95,
    }));
    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "overview.currency.1",
      dimension: "holding-currency",
      group: "EUR",
    }));
    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "overview.account.1",
      dimension: "source-account",
      rank: 1,
    }));
    expect(JSON.stringify(context)).not.toMatch(/account-private|Private Account|private-top-id|private-a|private-c/);
  });

  it("withholds holding names from portfolio overview facts", () => {
    const value = portfolio();
    value.insights.summary.topHolding = {
      id: "private-top-id",
      name: "Alpha",
      valueEur: 600,
      sharePercent: 60,
    };
    value.insights.recentMovers = {
      period: "today",
      strongest: { id: "private-a", name: "Alpha", changeEur: 8, percent: 1.2 },
      weakest: { id: "private-c", name: "Gamma", changeEur: -3, percent: -0.8 },
    };

    const context = createPortfolioAnalystTools(value).readPortfolioOverview({
      language: "en",
      includeHoldingNames: false,
    });

    expect(JSON.stringify(context)).not.toMatch(/Alpha|Gamma|private-/);
  });

  it("never substitutes an internal instrument id for an absent display name", () => {
    const value = portfolio();
    value.holdings[0]!.name = "internal-instrument-id";
    value.holdings[0]!.analystDisplayName = undefined;

    const context = createPortfolioAnalystTools(value).readPeriodDrivers({
      period: "week",
      language: "en",
      includeHoldingNames: true,
    });

    expect(JSON.stringify(context)).not.toContain("internal-instrument-id");
  });

  it("never substitutes an internal instrument id in data-quality gaps", () => {
    const value = portfolio();
    makeEveryPeriodAvailable(value);
    value.holdings[0]!.name = "internal-stale-id";
    value.holdings[0]!.analystDisplayName = undefined;
    value.holdings[0]!.freshness = "stale";

    const context = createPortfolioAnalystTools(value).readDataQuality({
      language: "en",
      includeHoldingNames: true,
    });

    expect(context.facts).toContainEqual(expect.objectContaining({
      key: "quality.gap.1",
      category: "stale-market-data",
    }));
    expect(JSON.stringify(context)).not.toContain("internal-stale-id");
  });

  it("keeps an earlier provider failure as history after a newer successful refresh", () => {
    const value = portfolio();
    makeEveryPeriodAvailable(value);
    value.marketData.refreshHistory = [
      {
        mode: "manual",
        provider: "synthetic-provider",
        completedAt: "2026-09-06T12:00:00.000Z",
        updated: 1,
        unchanged: 0,
        failed: 0,
        failures: [],
      },
      {
        mode: "automatic",
        provider: "synthetic-provider",
        completedAt: "2026-09-06T11:00:00.000Z",
        updated: 0,
        unchanged: 0,
        failed: 1,
        failures: [{
          instrumentCode: "PRIVATE",
          category: "timeout",
          message: "Provider request timed out",
        }],
      },
    ];

    const context = createPortfolioAnalystTools(value).readDataQuality({
      language: "en",
      includeHoldingNames: true,
    });

    expect(context.facts.filter((fact) => fact.kind === "data-gap")).toEqual([]);
    expect(context.facts.filter((fact) => fact.kind === "refresh-result")).toHaveLength(2);
    expect(context.allowedActions).toEqual([]);
  });

  it("fails locally when even safe provider summaries exceed the context ceiling", () => {
    const oversized = portfolio();
    oversized.marketData.refreshHistory = Array.from({ length: 3 }, (_, index) => ({
      mode: "manual" as const,
      provider: "p".repeat(15_000 + index),
      completedAt: `2026-09-0${index + 1}T11:00:00.000Z`,
      updated: 0,
      unchanged: 1,
      failed: 0,
      failures: [],
    }));

    expect(() => createPortfolioAnalystTools(oversized).readDataQuality({
      language: "en",
      includeHoldingNames: false,
    })).toThrowError(PortfolioAnalystContextError);
  });
});
