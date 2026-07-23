import { describe, expect, it, vi } from "vitest";

import { createTrading212ImportHandler } from "@/app/api/imports/trading212/route";
import type { ImportDraftInput, StoredImportDraft } from "@/domain/imports";
import type { PortfolioState } from "@/domain/portfolio/types";
import { Trading212RequestError } from "@/infrastructure/trading212/trading212-client";

function request(sourceAccountId = "trading212-main") {
  return new Request("http://localhost/api/imports/trading212", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceAccountId }),
  });
}

function database(state: PortfolioState = {
  positions: [],
  cashBalances: [],
  appliedEventIds: [],
}) {
  const drafts = new Map<string, StoredImportDraft>();
  return {
    saveImportDraft: vi.fn((draft: ImportDraftInput) => {
      drafts.set(draft.id, { ...draft, status: "draft" });
    }),
    getImportDraft: vi.fn((id: string) => drafts.get(id)),
    readPortfolioFacts: vi.fn(() => ({
      openingSnapshots: [],
      events: [],
      confirmedImports: [],
      confirmedSnapshots: [],
      state,
    })),
    recordMarketData: vi.fn(),
  };
}

const snapshot = {
  id: "snapshot-1",
  sourceAccountId: "trading212-main",
  asOf: "2026-07-21T12:00:00.000Z",
  portfolioCash: { amount: "50", currency: "EUR" },
  positions: [],
};

describe("POST /api/imports/trading212", () => {
  it("creates a review draft without directly changing the portfolio", async () => {
    const store = database();
    const handler = createTrading212ImportHandler({
      database: store,
      getConfig: () => ({ apiKey: "key", apiSecret: "secret", environment: "demo" }),
      createClient: () => ({ fetchAccountSnapshot: async () => snapshot }),
      newId: (() => {
        const ids = ["draft-1", "snapshot-1"];
        return () => ids.shift() ?? "unexpected";
      })(),
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      draft: {
        id: "draft-1",
        status: "draft",
        sourceKind: "trading-212",
        portfolio: {
          snapshotId: "snapshot-1",
          asOf: "2026-07-21T12:00:00.000Z",
          portfolioCash: { amount: "50", currency: "EUR" },
          holdings: [],
        },
      },
    });
    expect(store.saveImportDraft).toHaveBeenCalledOnce();
  });

  it("records a market observation without creating another review when holding state is unchanged", async () => {
    const store = database({
      positions: [{
        sourceAccountId: "trading212-main",
        instrumentId: "SYNTHETIC_EQQ",
        displayName: "Synthetic ETF",
        instrumentCode: "IE00SYNTHETIC",
        assetType: "etf",
        quantity: "2",
        currency: "EUR",
        costBasis: "100",
        reportedPriorReturn: "8",
        averageCost: "50",
        observedPrice: "54",
        priceAsOf: "2026-07-20T12:00:00.000Z",
        priceSource: "trading212",
        reportedMarketValue: "108",
      }],
      cashBalances: [{
        sourceAccountId: "trading212-main",
        amount: "50",
        currency: "EUR",
      }],
      appliedEventIds: [],
    });
    const handler = createTrading212ImportHandler({
      database: store,
      getConfig: () => ({ apiKey: "key", apiSecret: "secret", environment: "live" }),
      createClient: () => ({
        fetchAccountSnapshot: async () => ({
          id: "snapshot-2",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-21T12:00:00.000Z",
          portfolioCash: { amount: "50", currency: "EUR" },
          positions: [{
            instrumentId: "SYNTHETIC_EQQ",
            displayName: "Synthetic ETF",
            instrumentCode: "IE00SYNTHETIC",
            quantity: "2",
            currency: "EUR",
            costBasis: "100",
            reportedPriorReturn: "10",
            averageCost: "50",
            observedPrice: "55",
            priceAsOf: "2026-07-21T12:00:00.000Z",
            priceSource: "trading212",
            reportedMarketValue: "110",
          }],
        }),
      }),
      newId: () => "unused-id",
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "market-data-only",
      holdingChanges: 0,
      updatedPrices: 1,
      message: "Prices updated. No holding changes need review.",
    });
    expect(store.saveImportDraft).not.toHaveBeenCalled();
    expect(store.recordMarketData).toHaveBeenCalledWith({
      observations: [{
        sourceAccountId: "trading212-main",
        instrumentId: "SYNTHETIC_EQQ",
        instrumentCode: "IE00SYNTHETIC",
        price: "55",
        currency: "EUR",
        asOf: "2026-07-21T12:00:00.000Z",
        recordedAt: "2026-07-21T12:00:00.000Z",
        source: "trading212",
      }],
    });
  });

  it("creates a Before/After review for quantity changes and holdings absent from a complete snapshot", async () => {
    const store = database({
      positions: [
        {
          sourceAccountId: "trading212-main",
          instrumentId: "ETF-A",
          displayName: "Synthetic ETF A",
          instrumentCode: "IE00SYNTHA",
          quantity: "2",
          currency: "EUR",
          costBasis: "100",
          reportedPriorReturn: "5",
        },
        {
          sourceAccountId: "trading212-main",
          instrumentId: "ETF-B",
          displayName: "Synthetic ETF B",
          instrumentCode: "IE00SYNTHB",
          quantity: "1",
          currency: "EUR",
          costBasis: "40",
          reportedPriorReturn: "2",
        },
      ],
      cashBalances: [{
        sourceAccountId: "trading212-main",
        amount: "0",
        currency: "EUR",
      }],
      appliedEventIds: [],
    });
    const handler = createTrading212ImportHandler({
      database: store,
      getConfig: () => ({ apiKey: "key", apiSecret: "secret", environment: "live" }),
      createClient: () => ({
        fetchAccountSnapshot: async () => ({
          id: "snapshot-changes",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-22T12:00:00.000Z",
          portfolioCash: { amount: "0", currency: "EUR" },
          positions: [{
            instrumentId: "ETF-A",
            displayName: "Synthetic ETF A",
            instrumentCode: "IE00SYNTHA",
            quantity: "3",
            currency: "EUR",
            costBasis: "160",
            reportedPriorReturn: "9",
            observedPrice: "57",
            priceAsOf: "2026-07-22T12:00:00.000Z",
            priceSource: "trading212",
            reportedMarketValue: "171",
          }],
        }),
      }),
      newId: (() => {
        const ids = ["draft-changes", "snapshot-changes"];
        return () => ids.shift() ?? "unexpected";
      })(),
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "review-required",
      draft: {
        id: "draft-changes",
        reconciliation: {
          mode: "complete",
          snapshotKind: "holding-state",
          changeCount: 2,
          holdings: [
            {
              kind: "holding-changed",
              changes: [
                { field: "quantity", before: "2", after: "3" },
                { field: "costBasis", before: "100", after: "160" },
              ],
            },
            {
              kind: "possibly-removed",
              before: { instrumentId: "ETF-B" },
            },
          ],
        },
      },
    });
    expect(store.saveImportDraft).toHaveBeenCalledOnce();
  });

  it("explains rejected credentials without leaking upstream details", async () => {
    const handler = createTrading212ImportHandler({
      database: database(),
      getConfig: () => ({ apiKey: "key", apiSecret: "secret", environment: "live" }),
      createClient: () => ({
        fetchAccountSnapshot: async () => {
          throw new Trading212RequestError(401);
        },
      }),
      newId: () => "id",
      logError: () => undefined,
    });

    const response = await handler(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Trading 212 rejected the credentials. Check the key and secret, read-only account/portfolio permissions, environment and IP restrictions.",
    });
  });

  it("reports when local credentials are not configured", async () => {
    const handler = createTrading212ImportHandler({
      database: database(),
      getConfig: () => undefined,
      createClient: () => { throw new Error("should not create client"); },
      newId: () => "id",
    });

    const response = await handler(request());

    expect(response.status).toBe(503);
  });
});
