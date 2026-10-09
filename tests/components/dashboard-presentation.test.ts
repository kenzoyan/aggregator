import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";
import { Dashboard } from "@/components/dashboard";
import { PortfolioInsights } from "@/components/portfolio-insights";

const insights: PortfolioInsightsReadModel = {
  asOf: "2026-09-11T19:26:00.000Z",
  summary: {
    investmentPositionCount: 2,
    sourceAccountCount: 1,
    topThreeSharePercent: 100,
  },
  holdingCurrencyAllocation: [],
  categoryAllocation: [],
  performance: {
    today: { available: false, changeEur: 0, percent: 0, priceChangeEur: 0, fxChangeEur: 0 },
    week: { available: false, changeEur: 0, percent: 0, priceChangeEur: 0, fxChangeEur: 0 },
    month: { available: false, changeEur: 0, percent: 0, priceChangeEur: 0, fxChangeEur: 0 },
  },
  dataQuality: {
    valuedHoldingCount: 2,
    freshCount: 2,
    manualCount: 0,
    staleCount: 0,
    awaitingNavCount: 0,
    missingInputCount: 0,
    availablePerformancePeriods: [],
  },
};

describe("dashboard presentation", () => {
  it("prioritizes current changes and attention without repeating quoted-currency exposure", () => {
    const markup = renderToStaticMarkup(createElement(PortfolioInsights, { insights }));

    expect(markup).toContain("Change sources &amp; data status");
    expect(markup).toContain("LATEST DAILY CHANGE SOURCES");
    expect(markup).toContain("NEEDS ATTENTION");
    expect(markup).toContain("Portfolio shape");
    expect(markup).not.toContain("HOLDING CURRENCY");
    expect(markup).not.toContain("OPTIONAL CLOUD NARRATIVE");
    expect(markup).not.toContain("Generate narrative");
  });

  it("makes capital-flow-adjusted investment movement the primary chart", () => {
    const markup = renderToStaticMarkup(createElement(Dashboard));

    expect(markup).toContain("Investment change");
    expect(markup).toContain('class="selected" aria-pressed="true">Investment change');
    expect(markup).toContain('class="selected" aria-pressed="true">7 days');
    expect(markup).toContain('aria-pressed="false">Total value');
  });
});
