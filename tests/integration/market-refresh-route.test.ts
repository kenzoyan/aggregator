import { describe, expect, it } from "vitest";

import { createMarketRefreshHandler } from "@/app/api/market-data/refresh/route";
import type { MarketPriceObservation } from "@/domain/market-data";
import type { PortfolioState } from "@/domain/portfolio/types";

describe("POST /api/market-data/refresh", () => {
  it("refreshes eligible fund NAVs and returns a desktop-friendly summary", async () => {
    const saved: MarketPriceObservation[] = [];
    const refreshRuns: unknown[] = [];
    const state: PortfolioState = {
      positions: [{
        sourceAccountId: "alipay-main",
        instrumentId: "alipay-main:040046",
        instrumentCode: "040046",
        assetType: "fund",
        quantity: "10",
        currency: "CNY",
        costBasis: "80",
        reportedPriorReturn: "20",
        observedPrice: "10",
        priceAsOf: "2026-07-16",
      }],
      cashBalances: [],
      appliedEventIds: [],
    };
    const handler = createMarketRefreshHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [{
            id: "opening",
            sourceAccountId: "alipay-main",
            asOf: "2026-07-17T08:00:00.000Z",
            positions: state.positions,
          }],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state,
        }),
        readMarketData: () => ({ observations: [], fxObservations: [] }),
        recordMarketData: ({ observations, refresh }) => {
          saved.push(...observations);
          if (refresh) refreshRuns.push(refresh);
        },
      },
      provider: {
        id: "fixture-provider",
        fetchSince: async () => [{
          instrumentCode: "040046",
          price: "10.5",
          currency: "CNY",
          asOf: "2026-07-17",
          source: "eastmoney",
        }],
      },
      now: () => "2026-07-19T15:00:00.000Z",
    });

    const response = await handler();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updated: 1,
      unchanged: 0,
      failed: [],
      refreshedAt: "2026-07-19T15:00:00.000Z",
    });
    expect(saved).toHaveLength(1);
    expect(refreshRuns).toEqual([{
      provider: "fixture-provider",
      completedAt: "2026-07-19T15:00:00.000Z",
      updated: 1,
      unchanged: 0,
      failed: 0,
      failures: [],
    }]);
  });
});
