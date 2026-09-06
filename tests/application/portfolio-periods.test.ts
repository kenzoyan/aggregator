import { describe, expect, it } from "vitest";

import { combinePortfolioPeriodHistory } from "@/application/portfolio-periods";
import type { PeriodPerformanceReadModel } from "@/application/portfolio-read-model";

const unavailable: PeriodPerformanceReadModel = {
  available: false,
  change: 0,
  percent: 0,
  points: [],
};

describe("portfolio period aggregation", () => {
  it("uses the sum of latest holding moves for Today", () => {
    const history = combinePortfolioPeriodHistory({
      currentTotalValueEur: 300,
      portfolioHistory: {
        today: {
          available: true,
          change: 1,
          percent: 0.33,
          points: [299, 300],
          valueHistory: {
            available: true,
            change: 1,
            percent: 1 / 299 * 100,
            investmentChange: 1,
            portfolioActivity: 0,
            activityAvailable: true,
            timeline: [],
          },
          baselineAsOf: "2026-07-23",
          currentAsOf: "2026-07-24",
        },
        week: unavailable,
        month: unavailable,
      },
      holdingHistory: {
        first: {
          today: {
            available: true,
            change: 5,
            percent: 5,
            points: [100, 105],
            priceChange: 4,
            fxChange: 1,
          },
          week: unavailable,
          month: unavailable,
        },
        second: {
          today: {
            available: true,
            change: -2,
            percent: -1,
            points: [200, 198],
            priceChange: -2,
            fxChange: 0,
          },
          week: unavailable,
          month: unavailable,
        },
      },
    });

    expect(history.today).toEqual({
      available: true,
      change: 3,
      percent: 3 / 297 * 100,
      points: [297, 300],
      dailyChanges: [{ asOf: "2026-07-24", change: 3 }],
      priceChange: 2,
      fxChange: 1,
      valueHistory: {
        available: true,
        change: 1,
        percent: 1 / 299 * 100,
        investmentChange: 1,
        portfolioActivity: 0,
        activityAvailable: true,
        timeline: [],
      },
    });
  });
});
