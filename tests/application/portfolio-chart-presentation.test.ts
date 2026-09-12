import { describe, expect, it } from "vitest";

import {
  createPortfolioChartPresentation,
} from "@/application/portfolio-chart-presentation";
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
    expect(createPortfolioChartPresentation("today", timeline).showValueTrend).toBe(false);
    expect(createPortfolioChartPresentation("week", timeline).showValueTrend).toBe(true);
  });

  it("keeps material activity and removes rounding-sized estimated events", () => {
    const presentation = createPortfolioChartPresentation("week", timeline);

    expect(presentation.portfolioActivities).toEqual([{
      asOf: "2026-09-06",
      portfolioActivityEur: 2_655,
    }]);
    expect(presentation.activityGroups).toHaveLength(2);
    expect(presentation.activityGroups[0]).toMatchObject({
      asOf: "2026-09-06",
      portfolioActivityEur: 2_655,
      holdingActivities: [{ name: "Fund A" }],
    });
    expect(presentation.markerDates).toEqual(["2026-09-06", "2026-09-11"]);
  });

  it("limits a busy value chart to the four most recent activity dates", () => {
    const busyTimeline = Array.from({ length: 6 }, (_, index) => ({
      ...timeline[0]!,
      asOf: `2026-09-${String(index + 1).padStart(2, "0")}`,
      holdingActivities: [{
        holdingId: `account:fund-${index}`,
        name: `Fund ${index}`,
        kind: "added" as const,
        quantityDelta: "1",
      }],
    }));

    expect(createPortfolioChartPresentation("week", busyTimeline).markerDates).toEqual([
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});
