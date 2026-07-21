import { describe, expect, it } from "vitest";

import { refreshFundNavs } from "@/application/market-refresh";
import type { MarketPriceObservation } from "@/domain/market-data";
import type { PortfolioState } from "@/domain/portfolio/types";

const state: PortfolioState = {
  positions: [
    {
      sourceAccountId: "alipay-main",
      instrumentId: "alipay-main:040046",
      instrumentCode: "040046",
      displayName: "Index fund",
      assetType: "fund",
      quantity: "432.2",
      currency: "CNY",
      costBasis: "3210",
      reportedPriorReturn: "299.55",
      observedPrice: "8.1202",
      priceAsOf: "2026-07-16",
      priceSource: "csv",
      reportedMarketValue: "3509.55",
    },
  ],
  cashBalances: [],
  appliedEventIds: [],
};

describe("fund NAV refresh", () => {
  it("records a newer NAV without changing quantity, cost basis or prior return", async () => {
    const saved: MarketPriceObservation[] = [];
    const originalState = structuredClone(state);

    const result = await refreshFundNavs({
      state,
      existingObservations: [],
      monitoringStartedAtByPosition: {
        "alipay-main:alipay-main:040046": "2026-07-17T08:00:00.000Z",
      },
      provider: {
        id: "fixture-provider",
        fetchSince: async () => [
          {
            instrumentCode: "040046",
            price: "8.1202",
            currency: "CNY",
            asOf: "2026-07-16",
            source: "eastmoney",
          },
          {
            instrumentCode: "040046",
            price: "8.2530",
            currency: "CNY",
            asOf: "2026-07-17",
            dailyChangePercent: "1.64",
            source: "eastmoney",
          },
          {
            instrumentCode: "040046",
            price: "8.3000",
            currency: "CNY",
            asOf: "2026-07-18",
            source: "eastmoney",
          },
        ],
      },
      record: (observations) => { saved.push(...observations); },
      now: "2026-07-19T14:00:00.000Z",
    });

    expect(result).toMatchObject({
      updated: 1,
      recordedPrices: 2,
      unchanged: 0,
      skipped: 0,
      failed: [],
    });
    expect(saved).toEqual([
      {
        sourceAccountId: "alipay-main",
        instrumentId: "alipay-main:040046",
        instrumentCode: "040046",
        price: "8.2530",
        currency: "CNY",
        asOf: "2026-07-17",
        recordedAt: "2026-07-19T14:00:00.000Z",
        source: "eastmoney",
      },
      {
        sourceAccountId: "alipay-main",
        instrumentId: "alipay-main:040046",
        instrumentCode: "040046",
        price: "8.3000",
        currency: "CNY",
        asOf: "2026-07-18",
        recordedAt: "2026-07-19T14:00:00.000Z",
        source: "eastmoney",
      },
    ]);
    expect(state).toEqual(originalState);
  });

  it("keeps the last successful observation when the provider fails", async () => {
    const existing: MarketPriceObservation = {
      sourceAccountId: "alipay-main",
      instrumentId: "alipay-main:040046",
      instrumentCode: "040046",
      price: "8.1202",
      currency: "CNY",
      asOf: "2026-07-16",
      recordedAt: "2026-07-18T10:00:00.000Z",
      source: "eastmoney",
    };
    const saved: MarketPriceObservation[] = [];

    const result = await refreshFundNavs({
      state,
      existingObservations: [existing],
      monitoringStartedAtByPosition: {
        "alipay-main:alipay-main:040046": "2026-07-17T08:00:00.000Z",
      },
      provider: {
        id: "fixture-provider",
        fetchSince: async () => { throw new Error("upstream unavailable"); },
      },
      record: (observations) => { saved.push(...observations); },
      now: "2026-07-19T14:00:00.000Z",
    });

    expect(result.updated).toBe(0);
    expect(result.failed).toEqual([{
      instrumentCode: "040046",
      message: "upstream unavailable",
    }]);
    expect(saved).toEqual([]);
    expect(existing).toMatchObject({ price: "8.1202", asOf: "2026-07-16" });
  });
});
