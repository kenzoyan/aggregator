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
    const earlierSnapshot = {
      ...snapshot,
      id: "opening-fund-earlier",
      asOf: "2026-07-19T09:00:00.000Z",
      positions: snapshot.positions.map((position) => ({
        ...position,
        observedPrice: "9",
        priceAsOf: "2026-07-19",
      })),
    };
    const recordMarketData = vi.fn();
    const handler = createPortfolioHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [earlierSnapshot, snapshot],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [
            {
              snapshot: earlierSnapshot,
              confirmedAt: "2026-07-19T09:05:00.000Z",
            },
            {
              snapshot,
              confirmedAt: "2026-07-20T09:05:00.000Z",
            },
          ],
          state: buildPortfolioState({
            openingSnapshots: [earlierSnapshot, snapshot],
            events: [],
          }),
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
      totalReturn: {
        originalAmount: 30,
        eurAmount: 3.75,
        percent: 37.5,
      },
      detail: {
        quantity: "10",
        costBasis: "80",
        currentPrice: "11",
        currentPriceAsOf: "2026-07-21",
        priceHistory: [
          {
            price: "11",
            asOf: "2026-07-21",
            source: "eastmoney",
          },
          {
            price: "10",
            asOf: "2026-07-20",
            source: "confirmed-snapshot",
          },
          {
            price: "9",
            asOf: "2026-07-19",
            source: "confirmed-snapshot",
          },
        ],
      },
    });
    expect(payload.portfolio.history.today).toMatchObject({
      priceChange: 1.2,
      fxChange: 0.55,
    });
    expect(payload.portfolio.fxOverview).toEqual({
      baseCurrency: "EUR",
      quoteCurrency: "CNY",
      currentRate: 8,
      asOf: "2026-07-21",
      history: [
        { asOf: "2026-07-20", rate: 8.333333333333334 },
        { asOf: "2026-07-21", rate: 8 },
      ],
    });
  });
});
