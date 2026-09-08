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
          marketRefreshHistory: [{
            mode: "automatic",
            provider: "eastmoney+danske-invest",
            completedAt: "2026-07-21T18:30:00.000Z",
            updated: 1,
            unchanged: 0,
            failed: 0,
            failures: [],
          }],
          latestMarketRefresh: {
            mode: "automatic",
            provider: "eastmoney+danske-invest",
            completedAt: "2026-07-21T18:30:00.000Z",
            updated: 1,
            unchanged: 0,
            failed: 0,
            failures: [],
          },
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
      sourceAccountId: "alipay-main",
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
    expect(payload.portfolio.marketData.refreshHistory).toEqual([{
      mode: "automatic",
      provider: "eastmoney+danske-invest",
      completedAt: "2026-07-21T18:30:00.000Z",
      updated: 1,
      unchanged: 0,
      failed: 0,
      failures: [],
    }]);
    expect(payload.portfolio.accountAllocation).toEqual([{
      sourceAccountId: "alipay-main",
      label: "Alipay",
      valueEur: 13.75,
      sharePercent: 100,
      holdingCount: 1,
    }]);
    expect(payload.portfolio.history.today).toMatchObject({
      priceChange: 1.2,
      fxChange: 0.55,
    });
    expect(payload.portfolio.insights).toMatchObject({
      asOf: "2026-07-21T23:59:59.999Z",
      summary: {
        investmentPositionCount: 1,
        sourceAccountCount: 1,
        topHolding: {
          name: "Synthetic Fund",
          valueEur: 13.75,
          sharePercent: 100,
        },
        topThreeSharePercent: 100,
      },
      holdingCurrencyAllocation: [{
        currency: "CNY",
        valueEur: 13.75,
        sharePercent: 100,
        holdingCount: 1,
      }],
      performance: {
        today: {
          available: true,
          changeEur: 1.75,
          priceChangeEur: 1.2,
          fxChangeEur: 0.55,
        },
      },
      dataQuality: {
        valuedHoldingCount: 1,
        freshCount: 1,
        staleCount: 0,
        awaitingNavCount: 0,
        missingInputCount: 0,
      },
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

  it("sums each holding's latest available Today move into the portfolio", async () => {
    const snapshot = {
      id: "shared-window-opening",
      sourceAccountId: "alipay-main",
      asOf: "2026-07-21T09:00:00.000Z",
      positions: [
        {
          instrumentId: "synthetic-cny-fund",
          displayName: "Synthetic CNY Fund",
          instrumentCode: "SYN-CNY",
          assetType: "fund" as const,
          quantity: "10",
          currency: "CNY",
          costBasis: "90",
          observedPrice: "10",
          priceAsOf: "2026-07-21",
        },
        {
          instrumentId: "synthetic-eur-etf",
          displayName: "Synthetic EUR ETF",
          instrumentCode: "SYN-EUR",
          assetType: "etf" as const,
          quantity: "1",
          currency: "EUR",
          costBasis: "100",
          observedPrice: "100",
          priceAsOf: "2026-07-21",
        },
      ],
    };
    const handler = createPortfolioHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [snapshot],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [{
            snapshot,
            confirmedAt: "2026-07-21T09:05:00.000Z",
          }],
          state: buildPortfolioState({
            openingSnapshots: [snapshot],
            events: [],
          }),
        }),
        readMarketData: () => ({
          observations: [
            {
              sourceAccountId: "alipay-main",
              instrumentId: "synthetic-cny-fund",
              instrumentCode: "SYN-CNY",
              price: "10",
              currency: "CNY",
              asOf: "2026-07-23",
              recordedAt: "2026-07-23T18:00:00.000Z",
              source: "fixture",
            },
            {
              sourceAccountId: "alipay-main",
              instrumentId: "synthetic-eur-etf",
              instrumentCode: "SYN-EUR",
              price: "90",
              currency: "EUR",
              asOf: "2026-07-23",
              recordedAt: "2026-07-23T18:00:00.000Z",
              source: "fixture",
            },
          ],
          fxObservations: [
            {
              currency: "CNY",
              eurPerUnit: "0.1",
              asOf: "2026-07-21",
              recordedAt: "2026-07-21T16:00:00.000Z",
              source: "ecb",
            },
            {
              currency: "CNY",
              eurPerUnit: "0.1",
              asOf: "2026-07-23",
              recordedAt: "2026-07-23T16:00:00.000Z",
              source: "ecb",
            },
          ],
        }),
        readSourceAccountLabels: () => ({}),
        recordMarketData: vi.fn(),
      },
      fetchLatestRates: async () => ({
        asOf: "2026-07-24",
        eurPerUnit: { EUR: "1", CNY: "0.101" },
      }),
      now: () => "2026-07-24T18:00:00.000Z",
    });

    const response = await handler();
    const payload = await response.json();
    const availableHoldingChanges = payload.portfolio.holdings
      .map((holding: {
        history?: { today?: { available: boolean; change: number } };
      }) => holding.history?.today)
      .filter((today: { available: boolean } | undefined) => today?.available)
      .reduce(
        (total: number, today: { change: number }) => total + today.change,
        0,
      );

    expect(payload.portfolio.history.today.available).toBe(true);
    expect(availableHoldingChanges)
      .toBeCloseTo(payload.portfolio.history.today.change, 8);
  });

  it("does not leak a later snapshot into Today's earlier baseline", async () => {
    const openingSnapshot = {
      id: "snapshot-knowledge-opening",
      sourceAccountId: "trading212-main",
      asOf: "2026-07-21T09:00:00.000Z",
      positions: [{
        instrumentId: "snapshot-priced-etf",
        displayName: "Snapshot Priced ETF",
        instrumentCode: "SYN-SNAPSHOT",
        assetType: "etf" as const,
        quantity: "1",
        currency: "EUR",
        costBasis: "100",
        observedPrice: "100",
        priceAsOf: "2026-07-21",
      }],
    };
    const laterSnapshot = {
      ...openingSnapshot,
      id: "snapshot-knowledge-later",
      asOf: "2026-07-24T12:00:00.000Z",
      positions: openingSnapshot.positions.map((position) => ({
        ...position,
        observedPrice: "90",
        priceAsOf: "2026-07-23",
      })),
    };
    const snapshots = [openingSnapshot, laterSnapshot];
    const handler = createPortfolioHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: snapshots,
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state: buildPortfolioState({
            openingSnapshots: snapshots,
            events: [],
          }),
        }),
        readMarketData: () => ({
          observations: [],
          fxObservations: [
            {
              currency: "CNY",
              eurPerUnit: "0.1",
              asOf: "2026-07-23",
              recordedAt: "2026-07-23T16:00:00.000Z",
              source: "ecb",
            },
            {
              currency: "CNY",
              eurPerUnit: "0.101",
              asOf: "2026-07-24",
              recordedAt: "2026-07-24T16:00:00.000Z",
              source: "ecb",
            },
          ],
        }),
        readSourceAccountLabels: () => ({}),
        recordMarketData: vi.fn(),
      },
      fetchLatestRates: async () => ({
        asOf: "2026-07-24",
        eurPerUnit: { EUR: "1", CNY: "0.101" },
      }),
      now: () => "2026-07-24T18:00:00.000Z",
    });

    const response = await handler();
    const payload = await response.json();
    const holdingToday = payload.portfolio.holdings[0].history.today;

    expect(holdingToday).toMatchObject({
      available: true,
      change: -10,
      baselineAsOf: "2026-07-21T23:59:59.999Z",
      currentAsOf: "2026-07-23T23:59:59.999Z",
    });
    expect(holdingToday.change)
      .toBeCloseTo(payload.portfolio.history.today.change, 8);
  });

  it("includes the latest QDII NAV move when today's FX is newer than the NAV", async () => {
    const snapshot = {
      id: "qdii-lag-opening",
      sourceAccountId: "alipay-main",
      asOf: "2026-07-22T09:00:00.000Z",
      positions: [{
        instrumentId: "synthetic-qdii",
        displayName: "Synthetic QDII Fund",
        instrumentCode: "000001",
        assetType: "fund" as const,
        quantity: "10",
        currency: "CNY",
        costBasis: "100",
        observedPrice: "10",
        priceAsOf: "2026-07-22",
      }],
    };
    const handler = createPortfolioHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [snapshot],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state: buildPortfolioState({
            openingSnapshots: [snapshot],
            events: [],
          }),
        }),
        readMarketData: () => ({
          observations: [{
            sourceAccountId: "alipay-main",
            instrumentId: "synthetic-qdii",
            instrumentCode: "000001",
            price: "11",
            currency: "CNY",
            asOf: "2026-07-23",
            recordedAt: "2026-07-24T09:00:00.000Z",
            source: "fixture",
          }],
          fxObservations: [
            {
              currency: "CNY",
              eurPerUnit: "0.09",
              asOf: "2026-07-22",
              recordedAt: "2026-07-22T16:00:00.000Z",
              source: "ecb",
            },
            {
              currency: "CNY",
              eurPerUnit: "0.1",
              asOf: "2026-07-23",
              recordedAt: "2026-07-23T16:00:00.000Z",
              source: "ecb",
            },
          ],
        }),
        readSourceAccountLabels: () => ({}),
        recordMarketData: vi.fn(),
      },
      fetchLatestRates: async () => ({
        asOf: "2026-07-24",
        eurPerUnit: { EUR: "1", CNY: "0.101" },
      }),
      now: () => "2026-07-24T18:00:00.000Z",
    });

    const response = await handler();
    const payload = await response.json();
    const holdingToday = payload.portfolio.holdings[0].history.today;

    expect(holdingToday).toMatchObject({
      available: true,
      change: 1.11,
      priceChange: 1,
      fxChange: 0.11,
      baselineAsOf: "2026-07-22T23:59:59.999Z",
      currentAsOf: "2026-07-23T23:59:59.999Z",
    });
    expect(payload.portfolio.history.today.change).toBeCloseTo(1.11, 8);
  });
});
