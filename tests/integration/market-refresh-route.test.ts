import { describe, expect, it, vi } from "vitest";

import { createMarketRefreshHandler } from "@/app/api/market-data/refresh/handler";
import type {
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type { PortfolioState } from "@/domain/portfolio/types";

describe("POST /api/market-data/refresh", () => {
  it("refreshes eligible fund NAVs and returns a desktop-friendly summary", async () => {
    const saved: MarketPriceObservation[] = [];
    const refreshRuns: unknown[] = [];
    const state: PortfolioState = {
      positions: [
        {
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
        },
        {
          sourceAccountId: "trading212-main",
          instrumentId: "EQQQ_EQ",
          instrumentCode: "IE00BYVTM552",
          assetType: "etf",
          quantity: "1",
          currency: "EUR",
          costBasis: "100",
          reportedPriorReturn: "0",
          observedPrice: "100",
          priceAsOf: "2026-07-16T15:00:00.000Z",
        },
      ],
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
      refreshTrading212Snapshot: async () => ({
        id: "trading212-market-refresh",
        sourceAccountId: "trading212-main",
        asOf: "2026-07-19T15:00:00.000Z",
        positions: [{
          instrumentId: "EQQQ_EQ",
          instrumentCode: "IE00BYVTM552",
          assetType: "etf",
          quantity: "1",
          currency: "EUR",
          costBasis: "100",
          observedPrice: "102",
          priceAsOf: "2026-07-19T15:00:00.000Z",
          priceSource: "trading212",
        }],
      }),
      now: () => "2026-07-19T15:00:00.000Z",
    });

    const response = await handler();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updated: 2,
      unchanged: 0,
      failed: [],
      refreshedAt: "2026-07-19T15:00:00.000Z",
    });
    expect(saved).toMatchObject([
      {
        sourceAccountId: "alipay-main",
        instrumentId: "alipay-main:040046",
        price: "10.5",
        source: "eastmoney",
      },
      {
        sourceAccountId: "trading212-main",
        instrumentId: "EQQQ_EQ",
        price: "102",
        source: "trading212",
      },
    ]);
    expect(refreshRuns).toEqual([{
      mode: "manual",
      provider: "fixture-provider+trading212",
      completedAt: "2026-07-19T15:00:00.000Z",
      updated: 2,
      unchanged: 0,
      failed: 0,
      failures: [],
    }]);
  });

  it("skips a repeated automatic refresh on the same Helsinki day", async () => {
    const fetchSince = vi.fn();
    const recordMarketData = vi.fn();
    const handler = createMarketRefreshHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state: { positions: [], cashBalances: [], appliedEventIds: [] },
        }),
        readMarketData: () => ({
          observations: [],
          fxObservations: [],
          latestMarketRefresh: {
            mode: "unknown",
            provider: "fixture-provider",
            completedAt: "2026-09-04T22:30:00.000Z",
            updated: 1,
            unchanged: 0,
            failed: 0,
            failures: [],
          },
        }),
        recordMarketData,
      },
      provider: { id: "fixture-provider", fetchSince },
      now: () => "2026-09-05T18:00:00.000Z",
    });

    const response = await handler({ mode: "automatic" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      automatic: true,
      skipped: true,
      reason: "already-refreshed-today",
      lastRefreshedAt: "2026-09-04T22:30:00.000Z",
    });
    expect(fetchSince).not.toHaveBeenCalled();
    expect(recordMarketData).not.toHaveBeenCalled();
  });

  it("runs automatically on a new Helsinki day and lets manual refresh bypass the gate", async () => {
    const fetchSince = vi.fn().mockResolvedValue([]);
    const recordMarketData = vi.fn();
    const latestMarketRefresh = {
      mode: "unknown" as const,
      provider: "fixture-provider",
      completedAt: "2026-09-04T20:30:00.000Z",
      updated: 0,
      unchanged: 1,
      failed: 0,
      failures: [],
    };
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
        priceAsOf: "2026-09-04",
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
            asOf: "2026-09-04T08:00:00.000Z",
            positions: state.positions,
          }],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state,
        }),
        readMarketData: () => ({
          observations: [],
          fxObservations: [],
          latestMarketRefresh,
        }),
        recordMarketData,
      },
      provider: { id: "fixture-provider", fetchSince },
      now: () => "2026-09-04T22:30:00.000Z",
    });

    const automatic = await handler({ mode: "automatic" });
    expect(automatic.status).toBe(200);
    expect((await automatic.json()).automatic).toBe(true);
    expect(fetchSince).toHaveBeenCalledTimes(1);

    const manual = await handler({ mode: "manual" });
    expect(manual.status).toBe(200);
    expect((await manual.json()).automatic).toBe(false);
    expect(fetchSince).toHaveBeenCalledTimes(2);
    expect(recordMarketData).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent automatic refreshes so providers run once", async () => {
    let releaseFetch: (() => void) | undefined;
    let latestMarketRefresh: MarketRefreshRecord = {
      mode: "unknown",
      provider: "fixture-provider",
      completedAt: "2026-09-04T10:00:00.000Z",
      updated: 0,
      unchanged: 0,
      failed: 0,
      failures: [],
    };
    const pendingFetch = new Promise<never[]>((resolve) => {
      releaseFetch = () => resolve([]);
    });
    const fetchSince = vi.fn(() => pendingFetch);
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
        priceAsOf: "2026-09-04",
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
            asOf: "2026-09-04T08:00:00.000Z",
            positions: state.positions,
          }],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state,
        }),
        readMarketData: () => ({
          observations: [],
          fxObservations: [],
          latestMarketRefresh,
        }),
        recordMarketData: ({ refresh }) => {
          if (refresh) latestMarketRefresh = refresh;
        },
      },
      provider: { id: "fixture-provider", fetchSince },
      now: () => "2026-09-05T10:00:00.000Z",
    });

    const first = handler({ mode: "automatic" });
    await vi.waitFor(() => expect(fetchSince).toHaveBeenCalledTimes(1));
    const second = handler({ mode: "automatic" });
    releaseFetch?.();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect((await firstResponse.json()).automatic).toBe(true);
    expect(await secondResponse.json()).toMatchObject({
      automatic: true,
      skipped: true,
      reason: "already-refreshed-today",
    });
    expect(fetchSince).toHaveBeenCalledTimes(1);
  });

  it("retries only a failed fund after a same-day cooldown", async () => {
    let now = "2026-09-05T08:00:00.000Z";
    let latestMarketRefresh: MarketRefreshRecord | undefined;
    const observations: MarketPriceObservation[] = [];
    const fundCodes = ["040046", "019670"];
    const state: PortfolioState = {
      positions: fundCodes.map((code) => ({
        sourceAccountId: "alipay-main",
        instrumentId: code,
        instrumentCode: code,
        assetType: "fund" as const,
        quantity: "10",
        currency: "CNY",
        costBasis: "80",
        reportedPriorReturn: "0",
        priceAsOf: "2026-09-04",
      })),
      cashBalances: [],
      appliedEventIds: [],
    };
    const fetchSince = vi.fn(async (code: string) => {
      if (code === "019670" && now === "2026-09-05T08:00:00.000Z") {
        throw new Error("request failed with 503");
      }
      return [{
        instrumentCode: code,
        price: "1.25",
        currency: "CNY" as const,
        asOf: "2026-09-05",
        source: "eastmoney",
      }];
    });
    const handler = createMarketRefreshHandler({
      database: {
        readPortfolioFacts: () => ({
          state,
          openingSnapshots: [],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
        }),
        readMarketData: () => ({
          observations,
          fxObservations: [],
          ...(latestMarketRefresh ? { latestMarketRefresh } : {}),
        }),
        recordMarketData: ({ observations: recorded, refresh }) => {
          observations.push(...recorded);
          if (refresh) latestMarketRefresh = refresh;
        },
      },
      provider: { id: "eastmoney", fetchSince },
      now: () => now,
    });

    const first = await handler({ mode: "automatic" });
    expect(await first.json()).toMatchObject({ updated: 1, failed: [{ instrumentCode: "019670" }] });
    now = "2026-09-05T08:15:00.000Z";
    const coolingDown = await handler({ mode: "automatic" });
    expect(await coolingDown.json()).toMatchObject({ skipped: true });
    now = "2026-09-05T08:31:00.000Z";
    const retry = await handler({ mode: "automatic" });
    expect(await retry.json()).toMatchObject({ updated: 1, failed: [] });
    const complete = await handler({ mode: "automatic" });
    expect(await complete.json()).toMatchObject({ skipped: true });
    expect(fetchSince.mock.calls.map(([code]) => code)).toEqual(["040046", "019670", "019670"]);
  });

  it("limits an automatic retry to one attempt and retains other failures", async () => {
    let now = "2026-09-05T08:31:00.000Z";
    let latestMarketRefresh: MarketRefreshRecord = {
      mode: "automatic",
      provider: "eastmoney",
      completedAt: "2026-09-05T08:00:00.000Z",
      updated: 0,
      unchanged: 0,
      failed: 2,
      failures: [
        {
          sourceAccountId: "alipay-main",
          instrumentId: "fund-1",
          instrumentCode: "040046",
          category: "provider-error",
          message: "provider unavailable",
        },
        {
          sourceAccountId: "danske-main",
          instrumentId: "fund-2",
          instrumentCode: "FI0000000000",
          category: "configuration",
          message: "route missing",
        },
      ],
    };
    const fetchSince = vi.fn(async () => { throw new Error("request failed with 503"); });
    const handler = createMarketRefreshHandler({
      database: {
        readPortfolioFacts: () => ({
          state: {
            positions: [{
              sourceAccountId: "alipay-main", instrumentId: "fund-1",
              instrumentCode: "040046", assetType: "fund", quantity: "1",
              currency: "CNY", costBasis: "1",
              reportedPriorReturn: "0",
            }],
            cashBalances: [], appliedEventIds: [],
          },
          openingSnapshots: [], events: [], confirmedImports: [], confirmedSnapshots: [],
        }),
        readMarketData: () => ({ observations: [], fxObservations: [], latestMarketRefresh }),
        recordMarketData: ({ refresh }) => { if (refresh) latestMarketRefresh = refresh; },
      },
      provider: { id: "eastmoney", fetchSince },
      now: () => now,
    });

    const retry = await handler({ mode: "automatic" });
    expect(await retry.json()).toMatchObject({ failed: [
      { category: "configuration" },
      { category: "provider-error", retryCount: 1 },
    ] });
    now = "2026-09-05T09:02:00.000Z";
    const exhausted = await handler({ mode: "automatic" });
    expect(await exhausted.json()).toMatchObject({ skipped: true });
    expect(fetchSince).toHaveBeenCalledTimes(1);
  });

  it("retries a failed Trading 212 snapshot without fetching successful fund NAVs", async () => {
    let now = "2026-09-05T08:00:00.000Z";
    let latestMarketRefresh: MarketRefreshRecord | undefined;
    const fetchSince = vi.fn(async () => [{
      instrumentCode: "040046", price: "1.25", currency: "CNY" as const,
      asOf: "2026-09-05", source: "eastmoney",
    }]);
    const refreshTrading212Snapshot = vi.fn(async () => {
      if (now === "2026-09-05T08:00:00.000Z") {
        throw new Error("Trading 212 read failed with status 503");
      }
      return undefined;
    });
    const handler = createMarketRefreshHandler({
      database: {
        readPortfolioFacts: () => ({
          state: {
            positions: [
              {
                sourceAccountId: "alipay-main", instrumentId: "fund-1",
                instrumentCode: "040046", assetType: "fund", quantity: "1",
                currency: "CNY", costBasis: "1", reportedPriorReturn: "0",
              },
              {
                sourceAccountId: "trading212-main", instrumentId: "stock-1",
                instrumentCode: "STOCK", assetType: "stock", quantity: "1",
                currency: "EUR", costBasis: "1", reportedPriorReturn: "0",
              },
            ],
            cashBalances: [], appliedEventIds: [],
          },
          openingSnapshots: [], events: [], confirmedImports: [], confirmedSnapshots: [],
        }),
        readMarketData: () => ({
          observations: [], fxObservations: [],
          ...(latestMarketRefresh ? { latestMarketRefresh } : {}),
        }),
        recordMarketData: ({ refresh }) => { if (refresh) latestMarketRefresh = refresh; },
      },
      provider: { id: "eastmoney", fetchSince },
      refreshTrading212Snapshot,
      now: () => now,
    });

    const first = await handler({ mode: "automatic" });
    expect(await first.json()).toMatchObject({ failed: [{ category: "provider-error" }] });
    now = "2026-09-05T08:31:00.000Z";
    const retry = await handler({ mode: "automatic" });
    expect(await retry.json()).toMatchObject({ failed: [] });
    expect(fetchSince).toHaveBeenCalledTimes(1);
    expect(refreshTrading212Snapshot).toHaveBeenCalledTimes(2);
  });

  it("does not call providers for an automatic refresh without price positions", async () => {
    const fetchSince = vi.fn();
    const refreshTrading212Snapshot = vi.fn();
    const recordMarketData = vi.fn();
    const handler = createMarketRefreshHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state: {
            positions: [],
            cashBalances: [{
              sourceAccountId: "trading212-main",
              currency: "EUR",
              amount: "10",
            }],
            appliedEventIds: [],
          },
        }),
        readMarketData: () => ({ observations: [], fxObservations: [] }),
        recordMarketData,
      },
      provider: { id: "fixture-provider", fetchSince },
      refreshTrading212Snapshot,
      now: () => "2026-09-05T10:00:00.000Z",
    });

    const response = await handler({ mode: "automatic" });

    await expect(response.json()).resolves.toEqual({
      automatic: true,
      skipped: true,
      reason: "no-refreshable-positions",
    });
    expect(fetchSince).not.toHaveBeenCalled();
    expect(refreshTrading212Snapshot).not.toHaveBeenCalled();
    expect(recordMarketData).not.toHaveBeenCalled();
  });
});
