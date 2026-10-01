import { describe, expect, it } from "vitest";

import { shouldShowPortfolioValueTrend } from "@/application/portfolio-chart-presentation";
import type { PortfolioValuePointReadModel } from "@/application/portfolio-read-model";

const timeline: PortfolioValuePointReadModel[] = [
  {
    asOf: "2026-09-05",
    valueEur: 1_000,
    investmentChangeEur: 0,
    portfolioActivityEur: 0,
    holdingActivities: [],
  },
  {
    asOf: "2026-09-06",
    valueEur: 3_650,
    investmentChangeEur: -5,
    portfolioActivityEur: 2_655,
    holdingActivities: [{
      holdingId: "account:fund-a",
      name: "Fund A",
      kind: "added",
      quantityDelta: "10",
    }],
  },
  {
    asOf: "2026-09-08",
    valueEur: 3_650.02,
    investmentChangeEur: 0,
    portfolioActivityEur: 0.02,
    holdingActivities: [],
  },
  {
    asOf: "2026-09-11",
    valueEur: 3_649.97,
    investmentChangeEur: -0.05,
    portfolioActivityEur: 0,
    holdingActivities: [{
      holdingId: "account:fund-b",
      name: "Fund B",
      kind: "increased",
      quantityDelta: "0.1",
    }],
  },
];

describe("portfolio chart presentation", () => {
  it("does not draw a total-value trend for Today", () => {
    expect(shouldShowPortfolioValueTrend("today", timeline)).toBe(false);
    expect(shouldShowPortfolioValueTrend("week", timeline)).toBe(true);
  });

  it("requires two dated valuations for a total-value trend", () => {
    expect(shouldShowPortfolioValueTrend("week", timeline.slice(0, 1))).toBe(false);
    expect(shouldShowPortfolioValueTrend("month", timeline.slice(0, 2))).toBe(true);
  });
});
