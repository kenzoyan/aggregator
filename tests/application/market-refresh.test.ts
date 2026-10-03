import { describe, expect, it } from "vitest";

import {
  refreshFundNavs,
  safeMarketRefreshFailureMessage,
} from "@/application/market-refresh";
import type { MarketPriceObservation } from "@/domain/market-data";
import type { PortfolioState } from "@/domain/portfolio/types";
import { createSourceAccountDefinition } from "@/domain/source-accounts";

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
  it("records the published NAV on the import date when no provider observation exists", async () => {
    const saved: MarketPriceObservation[] = [];
    const result = await refreshFundNavs({
      state: {
        ...state,
        positions: [{ ...state.positions[0]!, priceAsOf: "2026-07-16" }],
      },
      existingObservations: [],
      monitoringStartedAtByPosition: {},
      provider: {
        id: "eastmoney",
        fetchSince: async () => [{
          instrumentCode: "040046",
          price: "8.1202",
          currency: "CNY",
          asOf: "2026-07-16",
          source: "eastmoney",
        }],
      },
      record: (observations) => { saved.push(...observations); },
      now: "2026-07-16T18:00:00.000Z",
    });

    expect(result).toMatchObject({ updated: 1, recordedPrices: 1 });
    expect(saved[0]).toMatchObject({ asOf: "2026-07-16", source: "eastmoney" });

    const repeated = await refreshFundNavs({
      state,
      existingObservations: saved,
      monitoringStartedAtByPosition: {},
      provider: {
        id: "eastmoney",
        fetchSince: async () => [{
          instrumentCode: "040046",
          price: "8.1202",
          currency: "CNY",
          asOf: "2026-07-16",
          source: "eastmoney",
        }],
      },
      record: () => { throw new Error("must not record the same NAV twice"); },
      now: "2026-07-16T19:00:00.000Z",
    });
    expect(repeated).toMatchObject({ updated: 0, recordedPrices: 0, unchanged: 1 });
  });

  it("refreshes a CNY fund held in a dynamically created WeChat account", async () => {
    const saved: MarketPriceObservation[] = [];
    const result = await refreshFundNavs({
      state: {
        positions: [{
          sourceAccountId: "account-wechat-wealth",
          instrumentId: "019670",
          instrumentCode: "019670",
          displayName: "Synthetic Hong Kong fund",
          assetType: "fund",
          quantity: "10",
          currency: "CNY",
          costBasis: "10",
          reportedPriorReturn: "0",
          priceAsOf: "2026-09-16",
        }],
        cashBalances: [],
        appliedEventIds: [],
      },
      sourceAccounts: [{
        ...createSourceAccountDefinition({
          id: "account-wechat-wealth",
          accountType: "WeChat Wealth",
        }),
        provider: "generic", // Existing accounts retain the provider stored before this alias existed.
      }],
      existingObservations: [],
      monitoringStartedAtByPosition: {},
      provider: {
        id: "eastmoney",
        supportsInstrumentCode: (code) => /^\d{6}$/.test(code),
        fetchSince: async () => [{
          instrumentCode: "019670",
          price: "1.3726",
          currency: "CNY",
          asOf: "2026-09-18",
          source: "eastmoney",
        }],
      },
      record: (observations) => { saved.push(...observations); },
      now: "2026-09-22T12:00:00.000Z",
    });

    expect(result).toMatchObject({ updated: 1, recordedPrices: 1, failed: [] });
    expect(saved[0]).toMatchObject({ instrumentCode: "019670", price: "1.3726" });
  });

  it("refreshes a fund in a Chinese-named WeChat account stored as generic", async () => {
    const account = {
      ...createSourceAccountDefinition({ id: "account-wechat-cn", accountType: "微信" }),
      provider: "generic" as const,
    };
    const saved: MarketPriceObservation[] = [];
    const result = await refreshFundNavs({
      state: {
        ...state,
        positions: [{
          ...state.positions[0]!,
          sourceAccountId: account.id,
          instrumentId: "synthetic-fund",
        }],
      },
      sourceAccounts: [account],
      existingObservations: [],
      monitoringStartedAtByPosition: {},
      provider: {
        id: "eastmoney",
        supportsInstrumentCode: (code) => /^\d{6}$/.test(code),
        fetchSince: async () => [{
          instrumentCode: "040046",
          price: "8.2530",
          currency: "CNY",
          asOf: "2026-07-17",
          source: "eastmoney",
        }],
      },
      record: (observations) => { saved.push(...observations); },
      now: "2026-07-17T18:00:00.000Z",
    });

    expect(result).toMatchObject({ updated: 1, recordedPrices: 1, failed: [] });
    expect(saved).toMatchObject([{ sourceAccountId: account.id, instrumentId: "synthetic-fund", source: "eastmoney" }]);
  });

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

  it("catches a published NAV between an imported price date and a holiday import", async () => {
    const saved: MarketPriceObservation[] = [];
    const requestedDates: string[] = [];
    const result = await refreshFundNavs({
      state: {
        ...state,
        positions: [{ ...state.positions[0]!, priceAsOf: "2026-09-29" }],
      },
      existingObservations: [],
      monitoringStartedAtByPosition: {
        "alipay-main:alipay-main:040046": "2026-10-03",
      },
      provider: {
        id: "eastmoney",
        fetchSince: async (_code, sinceDate) => {
          requestedDates.push(sinceDate);
          return sinceDate > "2026-09-30" ? [] : [{
            instrumentCode: "040046",
            price: "8.2530",
            currency: "CNY",
            asOf: "2026-09-30",
            source: "eastmoney",
          }];
        },
      },
      record: (observations) => { saved.push(...observations); },
      now: "2026-10-03T12:00:00.000Z",
    });

    expect(requestedDates).toEqual(["2026-09-29"]);
    expect(result).toMatchObject({ updated: 1, recordedPrices: 1 });
    expect(saved).toMatchObject([{ asOf: "2026-09-30", source: "eastmoney" }]);
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
      sourceAccountId: "alipay-main",
      instrumentId: "alipay-main:040046",
      category: "provider-error",
      message: "Market data provider could not be refreshed",
    }]);
    expect(saved).toEqual([]);
    expect(existing).toMatchObject({ price: "8.1202", asOf: "2026-07-16" });
  });

  it("records official EUR NAVs for a supported legacy-unclassified Danske ISIN", async () => {
    const danskeState: PortfolioState = {
      positions: [{
        sourceAccountId: "danske-main",
        instrumentId: "XX0000000001",
        instrumentCode: "XX0000000001",
        displayName: "Synthetic Technology Fund",
        quantity: "10",
        currency: "EUR",
        costBasis: "50",
        reportedPriorReturn: "10",
        observedPrice: "6",
        priceAsOf: "2026-09-03",
      }],
      cashBalances: [],
      appliedEventIds: [],
    };
    const saved: MarketPriceObservation[] = [];

    const result = await refreshFundNavs({
      state: danskeState,
      existingObservations: [],
      monitoringStartedAtByPosition: {
        "danske-main:XX0000000001": "2026-09-03T00:00:00.000Z",
      },
      provider: {
        id: "danske-invest",
        supportsInstrumentCode: (code) => code === "XX0000000001",
        fetchSince: async () => [{
          instrumentCode: "XX0000000001",
          price: "6.2",
          currency: "EUR",
          asOf: "2026-09-04",
          source: "danske-invest",
        }],
      },
      record: (observations) => { saved.push(...observations); },
      now: "2026-09-05T14:00:00.000Z",
    });

    expect(result).toMatchObject({ updated: 1, recordedPrices: 1, failed: [] });
    expect(saved[0]).toMatchObject({
      sourceAccountId: "danske-main",
      instrumentCode: "XX0000000001",
      currency: "EUR",
      price: "6.2",
    });
  });

  it("reports a safe configuration diagnostic for an unconfigured Danske fund", async () => {
    const danskeState: PortfolioState = {
      positions: [{
        sourceAccountId: "danske-main",
        instrumentId: "XX0000000002",
        instrumentCode: "XX0000000002",
        displayName: "Synthetic Unconfigured Fund",
        assetType: "fund",
        quantity: "10",
        currency: "EUR",
        costBasis: "50",
        reportedPriorReturn: "0",
        observedPrice: "5",
        priceAsOf: "2026-09-03",
      }],
      cashBalances: [],
      appliedEventIds: [],
    };

    const result = await refreshFundNavs({
      state: danskeState,
      existingObservations: [],
      monitoringStartedAtByPosition: {},
      provider: {
        id: "danske-invest",
        supportsInstrumentCode: () => false,
        fetchSince: async () => {
          throw new Error("must not be called");
        },
      },
      record: () => undefined,
      now: "2026-09-05T14:00:00.000Z",
    });

    expect(result).toMatchObject({
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: [{
        instrumentCode: "XX0000000002",
        message: "Automatic NAV route is not configured for this Danske Invest fund",
      }],
    });
  });

  it("stores a safe summary instead of an arbitrary provider error", async () => {
    const result = await refreshFundNavs({
      state,
      existingObservations: [],
      monitoringStartedAtByPosition: {},
      provider: {
        id: "fixture-provider",
        fetchSince: async () => {
          throw new Error("request failed for https://secret.example.test?token=sensitive");
        },
      },
      record: () => undefined,
      now: "2026-07-19T14:00:00.000Z",
    });

    expect(result.failed).toEqual([{
      instrumentCode: "040046",
      sourceAccountId: "alipay-main",
      instrumentId: "alipay-main:040046",
      category: "provider-error",
      message: "Market data provider could not be refreshed",
    }]);
  });

  it("keeps Trading 212 authentication and rate-limit summaries actionable", () => {
    expect(safeMarketRefreshFailureMessage(
      new Error("Trading 212 read failed with status 401"),
    )).toBe("Trading 212 credentials or read permissions were rejected");
    expect(safeMarketRefreshFailureMessage(
      new Error("Trading 212 read failed with status 429"),
    )).toBe("Trading 212 rate limit reached; try again later");
  });
});
