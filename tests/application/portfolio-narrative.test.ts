import { describe, expect, it } from "vitest";

import {
  createPortfolioNarrativeFacts,
  createPortfolioNarrativeFingerprint,
  portfolioNarrativeFreshness,
} from "@/application/portfolio-narrative-facts";
import { portfolioNarrativeContentSchema } from "@/application/portfolio-narrative";
import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";

const insights: PortfolioInsightsReadModel = {
  asOf: "2026-09-05T12:00:00.000Z",
  summary: {
    investmentPositionCount: 2,
    sourceAccountCount: 1,
    topHolding: {
      id: "synthetic:fund",
      name: "Synthetic Fund",
      valueEur: 700,
      sharePercent: 70,
    },
    topThreeSharePercent: 100,
  },
  holdingCurrencyAllocation: [
    { currency: "CNY", valueEur: 700, sharePercent: 70, holdingCount: 1 },
    { currency: "EUR", valueEur: 300, sharePercent: 30, holdingCount: 1 },
  ],
  categoryAllocation: [
    { category: "Fund", valueEur: 700, sharePercent: 70, holdingCount: 1 },
    { category: "ETF", valueEur: 300, sharePercent: 30, holdingCount: 1 },
  ],
  performance: {
    today: {
      available: true,
      changeEur: -2,
      percent: -0.2,
      priceChangeEur: 1,
      fxChangeEur: -3,
    },
    week: {
      available: false,
      changeEur: 0,
      percent: 0,
      priceChangeEur: 0,
      fxChangeEur: 0,
    },
    month: {
      available: false,
      changeEur: 0,
      percent: 0,
      priceChangeEur: 0,
      fxChangeEur: 0,
    },
  },
  dataQuality: {
    valuedHoldingCount: 2,
    freshCount: 2,
    manualCount: 0,
    staleCount: 0,
    awaitingNavCount: 0,
    missingInputCount: 0,
    availablePerformancePeriods: ["today"],
  },
};

describe("portfolio narrative facts", () => {
  it("creates a fixed provenance catalogue without raw holding facts", () => {
    expect(createPortfolioNarrativeFacts(insights)).toEqual([
      {
        key: "portfolio-as-of",
        label: "Portfolio facts as of",
        value: "2026-09-05T12:00:00.000Z",
      },
      {
        key: "composition",
        label: "Portfolio composition",
        value: "2 investments across 1 account; largest holding Synthetic Fund at 70.0%; top three 100.0%",
      },
      {
        key: "holding-currency",
        label: "Holding currency allocation",
        value: "CNY 70.0% (1); EUR 30.0% (1)",
      },
      {
        key: "asset-category",
        label: "Asset category allocation",
        value: "Fund 70.0% (1); ETF 30.0% (1)",
      },
      {
        key: "performance-today",
        label: "Today performance",
        value: "−€2.00 (−0.20%); price +€1.00; FX −€3.00",
      },
      {
        key: "performance-week",
        label: "7-day performance",
        value: "Unavailable",
      },
      {
        key: "performance-month",
        label: "30-day performance",
        value: "Unavailable",
      },
      {
        key: "recent-movers",
        label: "Latest available holding contributors",
        value: "Unavailable",
      },
      {
        key: "data-quality",
        label: "Data coverage",
        value: "2 valued; 2 fresh; 0 manual; 0 stale; 0 awaiting NAV; 0 missing inputs",
      },
    ]);
    expect(JSON.stringify(createPortfolioNarrativeFacts(insights)))
      .not.toContain("synthetic:fund");
  });

  it("ignores request time but changes when an underlying fact changes", () => {
    const original = createPortfolioNarrativeFingerprint(insights);
    expect(createPortfolioNarrativeFingerprint({
      ...insights,
      asOf: "2026-09-05T12:05:00.000Z",
    })).toBe(original);
    const changed = {
      ...insights,
      summary: { ...insights.summary, topThreeSharePercent: 99 },
    };
    expect(createPortfolioNarrativeFingerprint(changed)).not.toBe(original);
    expect(portfolioNarrativeFreshness(original, insights)).toBe("current");
    expect(portfolioNarrativeFreshness(original, changed)).toBe("previous");
  });

  it("rejects duplicate evidence keys in provider output", () => {
    expect(() => portfolioNarrativeContentSchema.parse({
      headline: { text: "Headline", evidence: ["composition", "composition"] },
      overview: { text: "Overview", evidence: ["composition"] },
      observations: [{ text: "Observation", evidence: ["performance-today"] }],
      dataQuality: { text: "Coverage", evidence: ["data-quality"] },
    })).toThrow("Evidence keys must be unique");
  });
});
