import { describe, expect, it } from "vitest";

import { createPortfolioValuationTimeline } from "@/application/portfolio-valuation-timeline";

describe("Portfolio valuation timeline", () => {
  it("derives current value and historical value from one snapshot timeline", () => {
    const portfolio = createPortfolioValuationTimeline({
      snapshots: [
        {
          id: "cash-opening",
          sourceAccountId: "danske-main",
          asOf: "2026-09-01T10:00:00.000Z",
          kind: "opening",
          portfolioCash: { amount: "100", currency: "EUR" },
          positions: [],
        },
        {
          id: "cash-update",
          sourceAccountId: "danske-main",
          asOf: "2026-09-05T10:00:00.000Z",
          kind: "holding-state",
          portfolioCash: { amount: "150", currency: "EUR" },
          positions: [],
        },
      ],
      events: [],
      marketPrices: [],
      fxObservations: [],
      accountLabels: { "danske-main": "Synthetic account" },
      asOf: "2026-09-06T10:00:00.000Z",
    });

    expect(portfolio.totalValueEur).toBe(150);
    expect(portfolio.history.week.valueHistory?.timeline.map((point) => ({
      asOf: point.asOf,
      valueEur: point.valueEur,
      portfolioActivityEur: point.portfolioActivityEur,
    }))).toEqual([
      {
        asOf: "2026-09-01",
        valueEur: 100,
        portfolioActivityEur: 0,
      },
      {
        asOf: "2026-09-05",
        valueEur: 150,
        portfolioActivityEur: 50,
      },
    ]);
  });
});
