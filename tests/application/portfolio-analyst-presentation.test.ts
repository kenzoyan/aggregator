import { describe, expect, it } from "vitest";

import {
  portfolioAnalystActionLabel,
  portfolioAnalystEvidenceValue,
  portfolioAnalystLimitationLabel,
} from "@/application/portfolio-analyst-presentation";

describe("portfolio analyst presentation", () => {
  it("renders factual actions as suggestions in either language", () => {
    const action = {
      kind: "refresh-fx" as const,
      currency: "USD",
      reasonEvidenceKey: "quality.gap.1",
    };
    expect(portfolioAnalystActionLabel(action, "en")).toBe("Refresh USD FX rate");
    expect(portfolioAnalystActionLabel(action, "zh-CN")).toBe("刷新 USD 汇率");
  });

  it("explains limitation codes without relying on provider prose", () => {
    expect(portfolioAnalystLimitationLabel("partial-period-coverage", "en"))
      .toContain("part of the portfolio");
    expect(portfolioAnalystLimitationLabel("portfolio-activity-cause-unknown", "zh-CN"))
      .toContain("无法");
  });

  it("formats cited evidence without exposing absent holding names", () => {
    const value = portfolioAnalystEvidenceValue({
      key: "driver.1",
      kind: "holding-driver",
      label: "Holding contribution",
      currentValueEur: 120,
      portfolioSharePercent: 12,
      contributionEur: -3.5,
      percent: -2.8,
      freshness: "fresh",
      baselineAsOf: "2026-09-01",
      currentAsOf: "2026-09-08",
      provenance: "holding-performance",
    }, "en");
    expect(value).toContain("Holding name withheld");
    expect(value).toContain("−€3.50");
    expect(value).toContain("current €120.00");
    expect(value).toContain("return -2.80%");
    expect(value).toContain("baseline 2026-09-01");
    expect(value).toContain("current date 2026-09-08");
  });

  it("keeps dates and estimated activity visible in cited period evidence", () => {
    const value = portfolioAnalystEvidenceValue({
      key: "period.total",
      kind: "period-performance",
      label: "Period performance",
      period: "week",
      coverage: "partial",
      changeEur: 10,
      percent: 2,
      priceEffectEur: 8,
      fxEffectEur: 2,
      baselineAsOf: "2026-09-01",
      currentAsOf: "2026-09-08",
      estimatedPortfolioActivityEur: 20,
      provenance: "portfolio-performance",
    }, "en");
    expect(value).toContain("baseline 2026-09-01");
    expect(value).toContain("current 2026-09-08");
    expect(value).toContain("estimated activity +€20.00");
  });
});
