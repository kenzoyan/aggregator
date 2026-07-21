import { describe, expect, it } from "vitest";

import {
  createDashboardReadModel,
  createPortfolioHistoryReadModel,
} from "@/application/portfolio-dashboard";
import { buildPortfolioState } from "@/domain/portfolio/ledger";

const openingSnapshot = {
  id: "opening-alipay",
  sourceAccountId: "alipay-main",
  asOf: "2026-07-12T09:00:00.000Z",
  positions: [{
    instrumentId: "alipay-main:040046",
    displayName: "Index fund",
    instrumentCode: "040046",
    assetType: "fund" as const,
    quantity: "10",
    currency: "CNY",
    costBasis: "80",
    reportedPriorReturn: "20",
    observedPrice: "10",
    priceAsOf: "2026-07-11",
    priceSource: "csv",
    reportedMarketValue: "100",
  }],
};

const marketPrices = [
  {
    sourceAccountId: "alipay-main",
    instrumentId: "alipay-main:040046",
    instrumentCode: "040046",
    price: "11",
    currency: "CNY",
    asOf: "2026-07-18",
    recordedAt: "2026-07-18T10:00:00.000Z",
    source: "eastmoney",
  },
  {
    sourceAccountId: "alipay-main",
    instrumentId: "alipay-main:040046",
    instrumentCode: "040046",
    price: "12",
    currency: "CNY",
    asOf: "2026-07-19",
    recordedAt: "2026-07-19T10:00:00.000Z",
    source: "eastmoney",
  },
];

describe("market-priced dashboard", () => {
  it("uses the latest saved NAV instead of the imported market value", () => {
    const readModel = createDashboardReadModel({
      state: buildPortfolioState({ openingSnapshots: [openingSnapshot], events: [] }),
      asOf: "2026-07-19T23:59:59.999Z",
      snapshotTimes: { "alipay-main": openingSnapshot.asOf },
      marketPrices,
      latestMarketRefresh: {
        provider: "eastmoney",
        completedAt: "2026-07-19T11:00:00.000Z",
        updated: 1,
        unchanged: 4,
        failed: 0,
        failures: [],
      },
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-18",
    });

    expect(readModel.totalValueEur).toBe(15);
    expect(readModel.holdings[0]).toMatchObject({
      originalValue: "120 CNY",
      eurValue: 15,
      freshness: "fresh",
      asOf: "2026-07-19",
    });
    expect(readModel.marketData).toMatchObject({
      lastRefreshedAt: "2026-07-19T11:00:00.000Z",
      latestResult: { updated: 1, unchanged: 4, failed: 0, failures: [] },
    });
  });

  it("calculates today and 7-day change from recorded prices without inventing 30-day history", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [openingSnapshot],
      marketPrices,
      asOf: "2026-07-19T23:59:59.999Z",
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-18",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 1.25,
    });
    expect(history.today.percent).toBeCloseTo(9.0909, 3);
    expect(history.week).toMatchObject({
      available: true,
      change: 2.5,
      percent: 20,
      points: [12.5, 13.75, 15],
    });
    expect(history.month.available).toBe(false);
  });

  it("uses the confirmed import as the first monitored baseline", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [openingSnapshot],
      marketPrices: [marketPrices[0]],
      asOf: "2026-07-21T12:00:00.000Z",
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 1.25,
      percent: 10,
      points: [12.5, 13.75],
    });
  });

  it("uses the previous published NAV for today across a weekend", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [openingSnapshot],
      marketPrices: [
        { ...marketPrices[0], asOf: "2026-07-17", price: "11" },
        { ...marketPrices[1], asOf: "2026-07-20", price: "12" },
      ],
      asOf: "2026-07-20T23:59:59.999Z",
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-20",
    });

    expect(history.today.available).toBe(true);
    expect(history.today.change).toBe(1.25);
  });

  it("does not count a newly tracked account opening balance as today's return", () => {
    const unchangedFundSnapshot = {
      ...openingSnapshot,
      asOf: "2026-07-19T09:00:00.000Z",
      positions: [{
        ...openingSnapshot.positions[0],
        currency: "EUR",
        quantity: "1",
        costBasis: "100",
        reportedPriorReturn: "0",
        observedPrice: "100",
        reportedMarketValue: "100",
      }],
    };
    const newlyTrackedAccount = {
      id: "opening-trading212",
      sourceAccountId: "trading212-main",
      asOf: "2026-07-21T10:00:00.000Z",
      positions: [{
        instrumentId: "trading212-main:etf-a",
        displayName: "Example ETF",
        instrumentCode: "ETF-A",
        assetType: "etf" as const,
        quantity: "1",
        currency: "EUR",
        costBasis: "150",
        reportedPriorReturn: "0",
        observedPrice: "150",
        priceAsOf: "2026-07-21",
        priceSource: "trading212",
        reportedMarketValue: "150",
      }],
    };
    const unchangedPrices = [
      {
        ...marketPrices[0],
        price: "100",
        currency: "EUR",
        asOf: "2026-07-20",
        recordedAt: "2026-07-20T10:00:00.000Z",
      },
      {
        ...marketPrices[1],
        price: "100",
        currency: "EUR",
        asOf: "2026-07-21",
        recordedAt: "2026-07-21T10:00:00.000Z",
      },
    ];

    const history = createPortfolioHistoryReadModel({
      snapshots: [unchangedFundSnapshot, newlyTrackedAccount],
      marketPrices: unchangedPrices,
      asOf: "2026-07-21T23:59:59.999Z",
      eurPerUnit: { EUR: "1" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 0,
      percent: 0,
    });
    expect(history.today.points).toEqual([100, 100, 100]);

    const historyAfterPriceMove = createPortfolioHistoryReadModel({
      snapshots: [unchangedFundSnapshot, newlyTrackedAccount],
      marketPrices: [
        ...unchangedPrices,
        {
          sourceAccountId: "trading212-main",
          instrumentId: "trading212-main:etf-a",
          instrumentCode: "ETF-A",
          price: "165",
          currency: "EUR",
          asOf: "2026-07-22",
          recordedAt: "2026-07-22T10:00:00.000Z",
          source: "trading212",
        },
      ],
      asOf: "2026-07-22T23:59:59.999Z",
      eurPerUnit: { EUR: "1" },
      fxAsOf: "2026-07-22",
    });

    expect(historyAfterPriceMove.today).toMatchObject({
      available: true,
      change: 15,
      percent: 6,
    });
    expect(historyAfterPriceMove.today.points).toEqual([250, 265]);
  });

  it("keeps an existing account's first monitored gain when another account is added", () => {
    const existingAccount = {
      ...openingSnapshot,
      asOf: "2026-07-19T09:00:00.000Z",
      positions: [{
        ...openingSnapshot.positions[0],
        currency: "EUR",
        quantity: "1",
        costBasis: "100",
        reportedPriorReturn: "0",
        observedPrice: "100",
        reportedMarketValue: "100",
      }],
    };
    const newlyTrackedAccount = {
      id: "opening-trading212",
      sourceAccountId: "trading212-main",
      asOf: "2026-07-21T10:00:00.000Z",
      positions: [{
        instrumentId: "trading212-main:etf-a",
        assetType: "etf" as const,
        quantity: "1",
        currency: "EUR",
        costBasis: "150",
        reportedPriorReturn: "0",
        observedPrice: "150",
        priceAsOf: "2026-07-21",
        reportedMarketValue: "150",
      }],
    };
    const firstPublishedPrice = {
      ...marketPrices[0],
      price: "110",
      currency: "EUR",
      asOf: "2026-07-21",
      recordedAt: "2026-07-21T18:00:00.000Z",
    };

    const history = createPortfolioHistoryReadModel({
      snapshots: [existingAccount, newlyTrackedAccount],
      marketPrices: [firstPublishedPrice],
      asOf: "2026-07-21T23:59:59.999Z",
      eurPerUnit: { EUR: "1" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 10,
      percent: 4,
    });
    expect(history.today.points).toEqual([100, 110, 110]);
  });
});
