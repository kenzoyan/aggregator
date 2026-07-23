import { describe, expect, it } from "vitest";

import { createPortfolioHistoryReadModel } from "@/application/portfolio-dashboard";

describe("portfolio dashboard history", () => {
  it("calculates recent change only when a confirmed baseline exists", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [
        {
          id: "old",
          sourceAccountId: "alipay-main",
          asOf: "2026-07-12T09:00:00.000Z",
          positions: [
            {
              instrumentId: "fund-a",
              quantity: "1",
              currency: "CNY",
              costBasis: "80",
              reportedPriorReturn: "20",
            },
          ],
        },
        {
          id: "new",
          sourceAccountId: "alipay-main",
          asOf: "2026-07-19T09:00:00.000Z",
          positions: [
            {
              instrumentId: "fund-a",
              quantity: "1",
              currency: "CNY",
              costBasis: "80",
              reportedPriorReturn: "30",
            },
          ],
        },
      ],
      asOf: "2026-07-19T12:00:00.000Z",
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-18",
    });

    expect(history.today.available).toBe(false);
    expect(history.week).toMatchObject({
      available: true,
      change: 1.25,
      percent: 10,
    });
    expect(history.month).toMatchObject({
      available: true,
      coverage: "partial",
      change: 1.25,
      percent: 10,
    });
    expect(history.week.points).toEqual([12.5, 13.75]);
  });

  it("includes a dated FX-only change in the portfolio timeline", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [{
        id: "opening-fx-only",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-20T09:00:00.000Z",
        positions: [{
          instrumentId: "fund-a",
          quantity: "10",
          currency: "CNY",
          costBasis: "100",
          observedPrice: "10",
          priceAsOf: "2026-07-20",
        }],
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
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 0.5,
      points: [12, 12.5],
    });
    expect(history.week).toMatchObject({
      available: true,
      coverage: "partial",
      change: 0.5,
      points: [12, 12.5],
    });
    expect(history.month).toMatchObject({
      available: true,
      coverage: "partial",
      change: 0.5,
      points: [12, 12.5],
    });
  });

  it("does not count a new holding in an existing account as period return", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [
        {
          id: "before-purchase",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-20T16:00:00.000Z",
          positions: [{
            instrumentId: "existing-etf",
            quantity: "1",
            currency: "EUR",
            costBasis: "100",
            observedPrice: "100",
          }],
        },
        {
          id: "after-purchase",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-21T16:00:00.000Z",
          positions: [
            {
              instrumentId: "existing-etf",
              quantity: "1",
              currency: "EUR",
              costBasis: "100",
              observedPrice: "110",
            },
            {
              instrumentId: "new-etf",
              quantity: "1",
              currency: "EUR",
              costBasis: "150",
              observedPrice: "150",
            },
          ],
        },
      ],
      marketPrices: [
        {
          sourceAccountId: "trading212-main",
          instrumentId: "existing-etf",
          instrumentCode: "existing-etf",
          price: "100",
          currency: "EUR",
          asOf: "2026-07-20",
          recordedAt: "2026-07-20T18:00:00.000Z",
          source: "trading212",
        },
        {
          sourceAccountId: "trading212-main",
          instrumentId: "existing-etf",
          instrumentCode: "existing-etf",
          price: "110",
          currency: "EUR",
          asOf: "2026-07-21",
          recordedAt: "2026-07-21T18:00:00.000Z",
          source: "trading212",
        },
        {
          sourceAccountId: "trading212-main",
          instrumentId: "new-etf",
          instrumentCode: "new-etf",
          price: "150",
          currency: "EUR",
          asOf: "2026-07-21",
          recordedAt: "2026-07-21T18:00:00.000Z",
          source: "trading212",
        },
      ],
      asOf: "2026-07-21T23:59:59.999Z",
      eurPerUnit: { EUR: "1" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 10,
      percent: 4,
    });
  });

  it("stays unavailable when the baseline cannot value an existing holding", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [{
        id: "opening-missing-fx",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-20T09:00:00.000Z",
        positions: [{
          instrumentId: "fund-missing-fx",
          quantity: "10",
          currency: "CNY",
          costBasis: "100",
          observedPrice: "10",
        }],
      }],
      marketPrices: [{
        sourceAccountId: "alipay-main",
        instrumentId: "fund-missing-fx",
        instrumentCode: "fund-missing-fx",
        price: "11",
        currency: "CNY",
        asOf: "2026-07-21",
        recordedAt: "2026-07-21T18:00:00.000Z",
        source: "fixture",
      }],
      fxObservations: [{
        currency: "CNY",
        eurPerUnit: "0.125",
        asOf: "2026-07-21",
        recordedAt: "2026-07-21T16:00:00.000Z",
        source: "ecb",
      }],
      asOf: "2026-07-21T23:59:59.999Z",
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today.available).toBe(false);
  });

  it("does not count additional units of the same holding as return", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [
        {
          id: "one-unit",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-20T16:00:00.000Z",
          positions: [{
            instrumentId: "same-etf",
            quantity: "1",
            currency: "EUR",
            costBasis: "100",
            observedPrice: "100",
          }],
        },
        {
          id: "two-units",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-21T16:00:00.000Z",
          positions: [{
            instrumentId: "same-etf",
            quantity: "2",
            currency: "EUR",
            costBasis: "200",
            observedPrice: "100",
          }],
        },
      ],
      asOf: "2026-07-21T23:59:59.999Z",
      eurPerUnit: { EUR: "1" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 0,
      percent: 0,
    });
  });

  it("reconstructs a sale event instead of ignoring the changed position and cash", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [{
        id: "before-sale",
        sourceAccountId: "trading212-main",
        asOf: "2026-07-20T16:00:00.000Z",
        positions: [{
          instrumentId: "sold-etf",
          quantity: "2",
          currency: "EUR",
          costBasis: "200",
          observedPrice: "100",
        }],
      }],
      events: [{
        id: "sale-1",
        type: "sale",
        sourceAccountId: "trading212-main",
        instrumentId: "sold-etf",
        asOf: "2026-07-21T12:00:00.000Z",
        quantity: "1",
        proceeds: { amount: "100", currency: "EUR" },
      }],
      marketPrices: [
        {
          sourceAccountId: "trading212-main",
          instrumentId: "sold-etf",
          instrumentCode: "sold-etf",
          price: "100",
          currency: "EUR",
          asOf: "2026-07-20",
          recordedAt: "2026-07-20T18:00:00.000Z",
          source: "trading212",
        },
        {
          sourceAccountId: "trading212-main",
          instrumentId: "sold-etf",
          instrumentCode: "sold-etf",
          price: "110",
          currency: "EUR",
          asOf: "2026-07-21",
          recordedAt: "2026-07-21T18:00:00.000Z",
          source: "trading212",
        },
      ],
      asOf: "2026-07-21T23:59:59.999Z",
      eurPerUnit: { EUR: "1" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today).toMatchObject({
      available: true,
      change: 10,
      percent: 5,
    });
  });

  it("does not label a stale portfolio point as today's baseline", () => {
    const history = createPortfolioHistoryReadModel({
      snapshots: [
        {
          id: "stale-portfolio",
          sourceAccountId: "trading212-main",
          asOf: "2026-06-21T16:00:00.000Z",
          positions: [{
            instrumentId: "stale-etf",
            quantity: "1",
            currency: "EUR",
            costBasis: "100",
            observedPrice: "100",
          }],
        },
        {
          id: "current-portfolio",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-21T16:00:00.000Z",
          positions: [{
            instrumentId: "stale-etf",
            quantity: "1",
            currency: "EUR",
            costBasis: "100",
            observedPrice: "110",
          }],
        },
      ],
      asOf: "2026-07-21T23:59:59.999Z",
      eurPerUnit: { EUR: "1" },
      fxAsOf: "2026-07-21",
    });

    expect(history.today.available).toBe(false);
    expect(history.week.available).toBe(false);
  });
});
