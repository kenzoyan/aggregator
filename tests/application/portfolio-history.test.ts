import { describe, expect, it } from "vitest";

import { createPortfolioHistoryReadModel } from "@/application/portfolio-dashboard";

describe("portfolio dashboard history", () => {
  it("calculates recent change only when a confirmed baseline exists", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [
        {
          id: "old",
          sourceAccountId: "alipay-main",
          asOf: "2026-07-12T09:00:00.000Z",
          positions: [
            {
              instrumentId: "fund-a",
              quantity: "1",
              currency: "CNY",
              costBasis: "80",
              reportedPriorReturn: "20",
            },
          ],
        },
        {
          id: "new",
          sourceAccountId: "alipay-main",
          asOf: "2026-07-19T09:00:00.000Z",
          positions: [
            {
              instrumentId: "fund-a",
              quantity: "1",
              currency: "CNY",
              costBasis: "80",
              reportedPriorReturn: "30",
            },
          ],
        },
      ],
      asOf: "2026-07-19T12:00:00.000Z",
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-18",
    });

    expect(history.today.available).toBe(false);
    expect(history.week).toMatchObject({
      available: true,
      change: 1.25,
      percent: 10,
    });
    expect(history.month.available).toBe(false);
    expect(history.week.points).toEqual([12.5, 13.75]);
  });
});
