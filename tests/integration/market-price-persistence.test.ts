import { describe, expect, it } from "vitest";

import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("market price persistence", () => {
  it("stores price observations separately from confirmed holding snapshots", () => {
    const database = createPortfolioDatabase(":memory:");
    const observation = {
      sourceAccountId: "alipay-main",
      instrumentId: "alipay-main:040046",
      instrumentCode: "040046",
      price: "8.253",
      currency: "CNY",
      asOf: "2026-07-17",
      recordedAt: "2026-07-19T14:00:00.000Z",
      source: "eastmoney",
    };

    database.recordMarketData({
      observations: [observation],
      refresh: {
        provider: "eastmoney",
        completedAt: "2026-07-19T14:01:00.000Z",
        updated: 0,
        unchanged: 5,
        failed: 1,
        failures: [{
          instrumentCode: "270042",
          message: "upstream unavailable",
        }],
      },
    });

    const data = database.readMarketData();
    expect(data.observations).toEqual([observation]);
    expect(data.latestMarketRefresh).toEqual({
      provider: "eastmoney",
      completedAt: "2026-07-19T14:01:00.000Z",
      updated: 0,
      unchanged: 5,
      failed: 1,
      failures: [{
        instrumentCode: "270042",
        message: "upstream unavailable",
      }],
    });
    expect(database.readPortfolioFacts().openingSnapshots).toEqual([]);
    expect(database.readPortfolioFacts().state.positions).toEqual([]);
    database.close();
  });

  it("stores dated ECB FX observations idempotently for historical valuation", () => {
    const database = createPortfolioDatabase(":memory:");
    const firstFetch = {
      currency: "CNY",
      eurPerUnit: "0.12",
      asOf: "2026-07-20",
      recordedAt: "2026-07-21T08:00:00.000Z",
      source: "ecb",
    };
    const repeatedFetch = {
      ...firstFetch,
      recordedAt: "2026-07-21T09:00:00.000Z",
    };

    database.recordMarketData({
      observations: [],
      fxObservations: [firstFetch],
    });
    database.recordMarketData({
      observations: [],
      fxObservations: [repeatedFetch],
    });

    expect(database.readMarketData().fxObservations).toEqual([repeatedFetch]);
    database.close();
  });
});
