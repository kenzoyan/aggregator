import { describe, expect, it } from "vitest";

import { createPortfolioInsightsReadModel } from "@/application/portfolio-insights";
import type {
  HoldingReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";

function holding(
  overrides: Partial<HoldingReadModel> & Pick<HoldingReadModel, "id" | "name" | "eurValue">,
): HoldingReadModel {
  return {
    sourceAccountId: overrides.id.split(":")[0]!,
    symbol: overrides.id,
    source: "Alipay",
    category: "Fund",
    currency: "CNY",
    originalValue: "CNY 0.00",
    changeEur: 0,
    changePercent: 0,
    freshness: "fresh",
    asOf: "2026-08-29",
    ...overrides,
  };
}

describe("portfolio insights", () => {
  it("summarizes concentration, exposure, movers and data coverage from portfolio facts", () => {
    const unavailable = {
      available: false,
      change: 0,
      percent: 0,
      points: [],
    };
    const holdings: HoldingReadModel[] = [
      holding({
        id: "alipay:fund-a",
        name: "Fund A",
        eurValue: 600,
        history: {
          today: {
            available: true,
            change: 12,
            percent: 2,
            points: [588, 600],
            priceChange: 10,
            fxChange: 2,
          },
          week: unavailable,
          month: unavailable,
        },
      }),
      holding({
        id: "trading212:etf-b",
        name: "ETF B",
        eurValue: 250,
        source: "Trading 212",
        category: "ETF",
        currency: "EUR",
        freshness: "stale",
        history: {
          today: {
            available: true,
            change: -5,
            percent: -1.96,
            points: [255, 250],
            priceChange: -5,
            fxChange: 0,
          },
          week: unavailable,
          month: unavailable,
        },
      }),
      holding({
        id: "alipay:fund-c",
        name: "Fund C",
        eurValue: 100,
        freshness: "awaiting-nav",
      }),
      holding({
        id: "trading212:cash:EUR",
        name: "Portfolio Cash",
        eurValue: 50,
        source: "Trading 212",
        category: "Portfolio cash",
        currency: "EUR",
      }),
    ];
    const portfolio: PortfolioOverviewReadModel = {
      holdings,
      totalValueEur: 1_000,
      accountAllocation: [],
      fxAsOf: "2026-08-29",
      missingInputs: [{ instrumentId: "missing-price" }],
      marketData: {},
      history: {
        today: {
          available: true,
          change: 7,
          percent: 0.7,
          points: [993, 1_000],
          priceChange: 5,
          fxChange: 2,
        },
        week: unavailable,
        month: unavailable,
      },
    };

    const insights = createPortfolioInsightsReadModel({
      portfolio,
      asOf: "2026-08-30T10:00:00.000Z",
    });

    expect(insights.summary).toEqual({
      investmentPositionCount: 3,
      sourceAccountCount: 2,
      topHolding: {
        id: "alipay:fund-a",
        name: "Fund A",
        valueEur: 600,
        sharePercent: 60,
      },
      topThreeSharePercent: 95,
    });
    expect(insights.holdingCurrencyAllocation).toEqual([
      { currency: "CNY", valueEur: 700, sharePercent: 70, holdingCount: 2 },
      { currency: "EUR", valueEur: 300, sharePercent: 30, holdingCount: 2 },
    ]);
    expect(insights.categoryAllocation).toEqual([
      { category: "Fund", valueEur: 700, sharePercent: 70, holdingCount: 2 },
      { category: "ETF", valueEur: 250, sharePercent: 25, holdingCount: 1 },
      { category: "Portfolio cash", valueEur: 50, sharePercent: 5, holdingCount: 1 },
    ]);
    expect(insights.recentMovers).toEqual({
      period: "today",
      strongest: {
        id: "alipay:fund-a",
        name: "Fund A",
        changeEur: 12,
        percent: 2,
      },
      weakest: {
        id: "trading212:etf-b",
        name: "ETF B",
        changeEur: -5,
        percent: -1.96,
      },
    });
    expect(insights.dataQuality).toEqual({
      valuedHoldingCount: 4,
      freshCount: 2,
      manualCount: 0,
      staleCount: 1,
      awaitingNavCount: 1,
      missingInputCount: 1,
      availablePerformancePeriods: ["today"],
    });
    expect(insights.performance.today).toMatchObject({
      available: true,
      changeEur: 7,
      percent: 0.7,
      priceChangeEur: 5,
      fxChangeEur: 2,
    });
    expect(insights.asOf).toBe("2026-08-30T10:00:00.000Z");
  });
});
