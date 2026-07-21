import { describe, expect, it } from "vitest";

import { createPortfolioRepository } from "@/infrastructure/sqlite/portfolio-repository";

describe("market price persistence", () => {
  it("stores price observations separately from confirmed holding snapshots", () => {
    const repository = createPortfolioRepository(":memory:");
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

    repository.saveMarketPriceObservations([observation]);
    repository.saveMarketRefreshRecord({
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

    expect(repository.getMarketPriceObservations()).toEqual([observation]);
    expect(repository.getLatestMarketRefreshRecord()).toEqual({
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
    expect(repository.getOpeningSnapshots()).toEqual([]);
    expect(repository.getPortfolioState().positions).toEqual([]);
    repository.close();
  });
});
