import { describe, expect, it } from "vitest";

import { Trading212Client } from "@/infrastructure/trading212/trading212-client";

describe("Trading 212 read-only client", () => {
  it("uses only read endpoints and maps current holdings into an opening snapshot", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/equity/account/summary")) {
        return Response.json({
          cash: { availableToTrade: 100, inPies: 5, reservedForOrders: 10 },
          currency: "EUR",
          id: 212,
          investments: {
            currentValue: 215,
            realizedProfitLoss: 7,
            totalCost: 200,
            unrealizedProfitLoss: 15,
          },
          totalValue: 330,
        });
      }
      return Response.json([
        {
          averagePricePaid: 100,
          createdAt: "2025-01-01T00:00:00Z",
          currentPrice: 107.5,
          instrument: {
            currency: "USD",
            isin: "US0000000001",
            name: "Example Equity",
            ticker: "EXAMPLE_US_EQ",
          },
          quantity: 2,
          quantityAvailableForTrading: 2,
          quantityInPies: 0,
          walletImpact: {
            currency: "EUR",
            currentValue: 215,
            fxImpact: 1.2,
            totalCost: 200,
            unrealizedProfitLoss: 15,
          },
        },
      ]);
    };

    const client = new Trading212Client({
      apiKey: "read-key",
      apiSecret: "read-secret",
      environment: "demo",
      fetch: fakeFetch,
      now: () => new Date("2026-07-19T12:00:00.000Z"),
    });

    const snapshot = await client.fetchOpeningSnapshot({
      id: "t212-snapshot-1",
      sourceAccountId: "trading212-main",
    });

    expect(snapshot).toEqual({
      id: "t212-snapshot-1",
      sourceAccountId: "trading212-main",
      asOf: "2026-07-19T12:00:00.000Z",
      portfolioCash: { amount: "115", currency: "EUR" },
      positions: [
        {
          instrumentId: "EXAMPLE_US_EQ",
          displayName: "Example Equity",
          instrumentCode: "US0000000001",
          assetType: "stock",
          quantity: "2",
          currency: "EUR",
          costBasis: "200",
          reportedPriorReturn: "15",
          averageCost: "100",
          observedPrice: "107.5",
          priceAsOf: "2026-07-19T12:00:00.000Z",
          priceSource: "trading212",
          reportedMarketValue: "215",
        },
      ],
    });
    expect(requests.map((request) => [request.init?.method, request.url])).toEqual([
      ["GET", "https://demo.trading212.com/api/v0/equity/account/summary"],
      ["GET", "https://demo.trading212.com/api/v0/equity/positions"],
    ]);
    expect(requests[0].init?.headers).toEqual({
      accept: "application/json",
      authorization: `Basic ${Buffer.from("read-key:read-secret").toString("base64")}`,
    });
  });
});
