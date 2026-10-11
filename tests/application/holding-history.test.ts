import { describe, expect, it } from "vitest";

import { createHoldingHistoryReadModel } from "@/application/holding-history";
import { buildPortfolioState } from "@/domain/portfolio/ledger";

describe("holding history read model", () => {
  it("calculates an ETF's EUR change and chart points from dated prices", () => {
    const snapshot = {
      id: "opening-etf",
      sourceAccountId: "trading212-main",
      asOf: "2026-07-20T16:00:00.000Z",
      positions: [{
        instrumentId: "T212-ETF-FIXTURE",
        assetType: "etf" as const,
        quantity: "2",
        currency: "EUR",
        costBasis: "200",
        observedPrice: "100",
        priceAsOf: "2026-07-20T16:00:00.000Z",
      }],
    };
    const state = buildPortfolioState({ openingSnapshots: [snapshot], events: [] });

    const history = createHoldingHistoryReadModel({
      state,
      snapshots: [snapshot],
      marketPrices: [{
        sourceAccountId: "trading212-main",
        instrumentId: "T212-ETF-FIXTURE",
        instrumentCode: "T212-ETF-FIXTURE",
        price: "110",
        currency: "EUR",
        asOf: "2026-07-21",
        recordedAt: "2026-07-21T18:00:00.000Z",
        source: "trading212",
      }],
      fxObservations: [],
      asOf: "2026-07-21T23:59:59.999Z",
    });

    expect(history["trading212-main:T212-ETF-FIXTURE"].today).toEqual({
      available: true,
      change: 20,
      percent: 10,
      points: [200, 220],
      holdingPoints: [
        { asOf: "2026-07-20", priceAsOf: "2026-07-20", unitPrice: "100", valueEur: 200 },
        { asOf: "2026-07-21", priceAsOf: "2026-07-21", unitPrice: "110", valueEur: 220 },
      ],
      priceChange: 20,
      fxChange: 0,
      baselineAsOf: "2026-07-20T23:59:59.999Z",
      currentAsOf: "2026-07-21T23:59:59.999Z",
      valuationBaselineAsOf: "2026-07-20T23:59:59.999Z",
      valuationCurrentAsOf: "2026-07-21T23:59:59.999Z",
    });
    expect(history["trading212-main:T212-ETF-FIXTURE"].week).toMatchObject({
      available: true,
      coverage: "partial",
      change: 20,
      percent: 10,
      points: [200, 220],
      baselineAsOf: "2026-07-20T23:59:59.999Z",
      currentAsOf: "2026-07-21T23:59:59.999Z",
    });
    expect(history["trading212-main:T212-ETF-FIXTURE"].month)
      .toMatchObject({
        available: true,
        coverage: "partial",
        change: 20,
        percent: 10,
        points: [200, 220],
      });
  });

  it("includes dated FX movement in a non-EUR holding's change", () => {
    const snapshot = {
      id: "opening-fund",
      sourceAccountId: "alipay-main",
      asOf: "2026-07-20T09:00:00.000Z",
      positions: [{
        instrumentId: "040046",
        quantity: "10",
        currency: "CNY",
        costBasis: "80",
        observedPrice: "10",
        priceAsOf: "2026-07-20",
      }],
    };
    const state = buildPortfolioState({ openingSnapshots: [snapshot], events: [] });

    const history = createHoldingHistoryReadModel({
      state,
      snapshots: [snapshot],
      marketPrices: [{
        sourceAccountId: "alipay-main",
        instrumentId: "040046",
        instrumentCode: "040046",
        price: "10",
        currency: "CNY",
        asOf: "2026-07-21",
        recordedAt: "2026-07-21T18:00:00.000Z",
        source: "eastmoney",
      }],
      fxObservations: [
        {
          currency: "CNY",
          eurPerUnit: "0.12",
          asOf: "2026-07-20",
          recordedAt: "2026-07-20T16:00:00.000Z",
          source: "ecb",
        },
        {
          currency: "CNY",
          eurPerUnit: "0.125",
          asOf: "2026-07-21",
          recordedAt: "2026-07-21T16:00:00.000Z",
          source: "ecb",
        },
      ],
      asOf: "2026-07-21T23:59:59.999Z",
    });

    expect(history["alipay-main:040046"].today.change).toBeCloseTo(0.5, 8);
    expect(history["alipay-main:040046"].today.percent).toBeCloseTo(4.16666667, 6);
    expect(history["alipay-main:040046"].today.points).toEqual([12, 12.5]);
    expect(history["alipay-main:040046"].today.priceChange).toBe(0);
    expect(history["alipay-main:040046"].today.fxChange).toBeCloseTo(0.5, 8);
  });

  it("records an FX-only holding change when the source price is unchanged", () => {
    const snapshot = {
      id: "opening-fx-only",
      sourceAccountId: "alipay-main",
      asOf: "2026-07-20T09:00:00.000Z",
      positions: [{
        instrumentId: "fund-fx-only",
        quantity: "10",
        currency: "CNY",
        costBasis: "100",
        observedPrice: "10",
        priceAsOf: "2026-07-20",
      }],
    };

    const history = createHoldingHistoryReadModel({
      state: buildPortfolioState({ openingSnapshots: [snapshot], events: [] }),
      snapshots: [snapshot],
      marketPrices: [],
      fxObservations: [
        {
          currency: "CNY",
          eurPerUnit: "0.12",
          asOf: "2026-07-20",
          recordedAt: "2026-07-20T16:00:00.000Z",
          source: "ecb",
        },
        {
          currency: "CNY",
          eurPerUnit: "0.125",
          asOf: "2026-07-21",
          recordedAt: "2026-07-21T16:00:00.000Z",
          source: "ecb",
        },
      ],
      asOf: "2026-07-21T23:59:59.999Z",
    });

    expect(history["alipay-main:fund-fx-only"].today).toMatchObject({
      available: true,
      change: 0.5,
      points: [12, 12.5],
      currentAsOf: "2026-07-20T23:59:59.999Z",
      holdingPoints: [
        { asOf: "2026-07-20", priceAsOf: "2026-07-20", unitPrice: "10", valueEur: 12 },
        { asOf: "2026-07-21", priceAsOf: "2026-07-20", unitPrice: "10", valueEur: 12.5 },
      ],
    });
  });

  it("labels an FX-driven baseline with the NAV date it actually used", () => {
    const snapshot = {
      id: "opening-fx-price-date",
      sourceAccountId: "fixture-account",
      asOf: "2026-07-20T09:00:00.000Z",
      positions: [{
        instrumentId: "fixture-fund",
        quantity: "10",
        currency: "CNY",
        costBasis: "100",
        observedPrice: "10",
        priceAsOf: "2026-07-20",
      }],
    };
    const history = createHoldingHistoryReadModel({
      state: buildPortfolioState({ openingSnapshots: [snapshot], events: [] }),
      snapshots: [snapshot],
      marketPrices: [],
      fxObservations: [
        {
          currency: "CNY",
          eurPerUnit: "0.12",
          asOf: "2026-07-20",
          recordedAt: "2026-07-20T16:00:00.000Z",
          source: "ecb",
        },
        {
          currency: "CNY",
          eurPerUnit: "0.125",
          asOf: "2026-07-21",
          recordedAt: "2026-07-21T16:00:00.000Z",
          source: "ecb",
        },
        {
          currency: "CNY",
          eurPerUnit: "0.13",
          asOf: "2026-07-22",
          recordedAt: "2026-07-22T16:00:00.000Z",
          source: "ecb",
        },
      ],
      asOf: "2026-07-22T23:59:59.999Z",
    });

    expect(history["fixture-account:fixture-fund"].today).toMatchObject({
      available: true,
      baselineAsOf: "2026-07-20T23:59:59.999Z",
      currentAsOf: "2026-07-20T23:59:59.999Z",
    });
  });

  it("keeps a newly tracked holding unavailable until a second dated value exists", () => {
    const snapshot = {
      id: "opening-new",
      sourceAccountId: "trading212-main",
      asOf: "2026-07-21T16:00:00.000Z",
      positions: [{
        instrumentId: "new-etf",
        quantity: "1",
        currency: "EUR",
        costBasis: "100",
        observedPrice: "100",
      }],
    };

    const history = createHoldingHistoryReadModel({
      state: buildPortfolioState({ openingSnapshots: [snapshot], events: [] }),
      snapshots: [snapshot],
      marketPrices: [],
      fxObservations: [],
      asOf: "2026-07-21T23:59:59.999Z",
    });

    expect(history["trading212-main:new-etf"].today).toEqual({
      available: false,
      change: 0,
      percent: 0,
      points: [100],
      priceChange: 0,
      fxChange: 0,
    });
  });

  it("does not label a month-old observation as today's baseline", () => {
    const snapshots = [
      {
        id: "old",
        sourceAccountId: "trading212-main",
        asOf: "2026-06-21T16:00:00.000Z",
        positions: [{
          instrumentId: "sparse-etf",
          quantity: "1",
          currency: "EUR",
          costBasis: "100",
          observedPrice: "100",
        }],
      },
      {
        id: "current",
        sourceAccountId: "trading212-main",
        asOf: "2026-07-21T16:00:00.000Z",
        positions: [{
          instrumentId: "sparse-etf",
          quantity: "1",
          currency: "EUR",
          costBasis: "100",
          observedPrice: "110",
        }],
      },
    ];

    const history = createHoldingHistoryReadModel({
      state: buildPortfolioState({ openingSnapshots: snapshots, events: [] }),
      snapshots,
      marketPrices: [],
      fxObservations: [],
      asOf: "2026-07-21T23:59:59.999Z",
    });

    expect(history["trading212-main:sparse-etf"].today.available).toBe(false);
    expect(history["trading212-main:sparse-etf"].week.available).toBe(false);
  });

  it("keeps a six-day price gap out of Today while retaining a seven-day baseline", () => {
    const snapshot = {
      id: "weekly-etf",
      sourceAccountId: "trading212-main",
      asOf: "2026-08-30T12:00:00.000Z",
      positions: [{
        instrumentId: "weekly-etf",
        quantity: "1",
        currency: "EUR",
        costBasis: "100",
        observedPrice: "100",
        priceAsOf: "2026-08-30T12:00:00.000Z",
      }],
    };
    const history = createHoldingHistoryReadModel({
      state: buildPortfolioState({ openingSnapshots: [snapshot], events: [] }),
      snapshots: [snapshot],
      marketPrices: [{
        sourceAccountId: "trading212-main",
        instrumentId: "weekly-etf",
        instrumentCode: "IE00WEEKLY",
        price: "105",
        currency: "EUR",
        asOf: "2026-09-05T12:00:00.000Z",
        recordedAt: "2026-09-05T12:00:00.000Z",
        source: "trading212",
      }],
      fxObservations: [],
      asOf: "2026-09-05T18:00:00.000Z",
    });

    expect(history["trading212-main:weekly-etf"].today.available).toBe(false);
    expect(history["trading212-main:weekly-etf"].week).toMatchObject({
      available: true,
      change: 5,
      percent: 5,
      baselineAsOf: "2026-08-30T23:59:59.999Z",
      currentAsOf: "2026-09-05T18:00:00.000Z",
    });
  });

  it("gives non-zero portfolio cash an FX history without treating cash additions as gain", () => {
    const snapshot = {
      id: "cash-cny",
      sourceAccountId: "alipay-main",
      asOf: "2026-07-20T09:00:00.000Z",
      portfolioCash: { amount: "100", currency: "CNY" },
      positions: [],
    };

    const history = createHoldingHistoryReadModel({
      state: buildPortfolioState({ openingSnapshots: [snapshot], events: [] }),
      snapshots: [snapshot],
      marketPrices: [],
      fxObservations: [
        {
          currency: "CNY",
          eurPerUnit: "0.12",
          asOf: "2026-07-20",
          recordedAt: "2026-07-20T16:00:00.000Z",
          source: "ecb",
        },
        {
          currency: "CNY",
          eurPerUnit: "0.125",
          asOf: "2026-07-21",
          recordedAt: "2026-07-21T16:00:00.000Z",
          source: "ecb",
        },
      ],
      asOf: "2026-07-21T23:59:59.999Z",
    });

    expect(history["alipay-main:cash:CNY"].today).toMatchObject({
      available: true,
      change: 0.5,
      points: [12, 12.5],
      priceChange: 0,
      fxChange: 0.5,
    });
    expect(history["alipay-main:cash:CNY"].today.percent)
      .toBeCloseTo(0.5 / 12 * 100, 8);
  });
});
