import { describe, expect, it, vi } from "vitest";

import { createPortfolioHandler } from "@/app/api/portfolio/route";
import { buildPortfolioState } from "@/domain/portfolio/ledger";

describe("GET /api/portfolio", () => {
  it("persists the latest ECB observation and returns holding period history", async () => {
    const snapshot = {
      id: "opening-fund",
      sourceAccountId: "alipay-main",
      asOf: "2026-07-20T09:00:00.000Z",
      positions: [{
        instrumentId: "040046",
        displayName: "Synthetic Fund",
        instrumentCode: "040046",
        assetType: "fund" as const,
        quantity: "10",
        currency: "CNY",
        costBasis: "80",
        observedPrice: "10",
        priceAsOf: "2026-07-20",
      }],
    };
    const recordMarketData = vi.fn();
    const handler = createPortfolioHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [snapshot],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [{
            snapshot,
            confirmedAt: "2026-07-20T09:05:00.000Z",
          }],
          state: buildPortfolioState({ openingSnapshots: [snapshot], events: [] }),
        }),
        readMarketData: () => ({
          observations: [{
            sourceAccountId: "alipay-main",
            instrumentId: "040046",
            instrumentCode: "040046",
            price: "11",
            currency: "CNY",
            asOf: "2026-07-21",
            recordedAt: "2026-07-21T18:00:00.000Z",
            source: "eastmoney",
          }],
          fxObservations: [{
            currency: "CNY",
            eurPerUnit: "0.12",
            asOf: "2026-07-20",
            recordedAt: "2026-07-20T16:00:00.000Z",
            source: "ecb",
          }],
        }),
        readSourceAccountLabels: () => ({}),
        recordMarketData,
      },
      fetchLatestRates: async () => ({
        asOf: "2026-07-21",
        eurPerUnit: { EUR: "1", CNY: "0.125" },
      }),
      now: () => "2026-07-21T23:59:59.999Z",
    });

    const response = await handler();
    const payload = await response.json();

    expect(recordMarketData).toHaveBeenCalledWith({
      observations: [],
      fxObservations: [{
        currency: "CNY",
        eurPerUnit: "0.125",
        asOf: "2026-07-21",
        recordedAt: "2026-07-21T23:59:59.999Z",
        source: "ecb",
      }],
    });
    expect(payload.portfolio.holdings[0].history.today).toMatchObject({
      available: true,
      change: 1.75,
      percent: 14.583333333333334,
      points: [12, 13.75],
      priceChange: 1.2,
      fxChange: 0.55,
    });
    expect(payload.portfolio.holdings[0]).toMatchObject({
      holdingKey: {
        sourceAccountId: "alipay-main",
        instrumentId: "040046",
      },
    });
    expect(payload.portfolio.history.today).toMatchObject({
      priceChange: 1.2,
      fxChange: 0.55,
    });
  });
});
