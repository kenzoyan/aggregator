import { describe, expect, it, vi } from "vitest";

import { createAccountsHandlers } from "@/app/api/accounts/handler";
import { buildPortfolioState } from "@/domain/portfolio/ledger";

describe("GET /api/accounts", () => {
  it("returns account allocation and market status from local data only", async () => {
    const snapshot = {
      id: "opening-alipay",
      sourceAccountId: "alipay-main",
      asOf: "2026-09-13T09:00:00.000Z",
      positions: [{
        instrumentId: "synthetic-fund",
        displayName: "Synthetic Fund",
        instrumentCode: "000001",
        assetType: "fund" as const,
        quantity: "10",
        currency: "EUR",
        costBasis: "100",
        observedPrice: "10",
        priceAsOf: "2026-09-13",
      }],
    };
    const renameSourceAccount = vi.fn();
    const handlers = createAccountsHandlers({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [snapshot],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [{ snapshot, confirmedAt: "2026-09-13T09:05:00.000Z" }],
          state: buildPortfolioState({ openingSnapshots: [snapshot], events: [] }),
        }),
        readMarketData: () => ({
          observations: [{
            sourceAccountId: "alipay-main",
            instrumentId: "synthetic-fund",
            instrumentCode: "000001",
            price: "11",
            currency: "EUR",
            asOf: "2026-09-14",
            recordedAt: "2026-09-14T08:00:00.000Z",
            source: "manual",
          }],
          fxObservations: [],
          marketRefreshHistory: [],
          latestMarketRefresh: undefined,
        }),
        readSourceAccountLabels: () => ({ "alipay-main": "Daily investments" }),
        renameSourceAccount,
      },
      now: () => "2026-09-14T12:00:00.000Z",
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
    });

    const response = await handlers.GET();
    const payload = await response.json();

    expect(payload.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "alipay-main",
        label: "Daily investments",
        holdingCount: 1,
      }),
    ]));
    expect(payload.accountAllocation).toEqual([expect.objectContaining({
      sourceAccountId: "alipay-main",
      valueEur: 110,
      sharePercent: 100,
    })]);
    expect(payload.marketDataStatuses).toEqual([{
      sourceAccountId: "alipay-main",
      status: "manual",
      asOf: "2026-09-14",
      holdingCount: 1,
    }]);
    expect(renameSourceAccount).not.toHaveBeenCalled();
  });

  it("renames an account and returns the refreshed accounts page", async () => {
    const labels: Record<string, string> = {};
    const handlers = createAccountsHandlers({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state: buildPortfolioState({ openingSnapshots: [], events: [] }),
        }),
        readMarketData: () => ({
          observations: [],
          fxObservations: [],
          marketRefreshHistory: [],
          latestMarketRefresh: undefined,
        }),
        readSourceAccountLabels: () => labels,
        renameSourceAccount: (id, label) => {
          labels[id] = label;
        },
      },
      now: () => "2026-09-14T12:00:00.000Z",
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
    });

    const response = await handlers.PATCH(new Request("http://localhost/api/accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "alipay-main", label: "Long-term savings" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "alipay-main", label: "Long-term savings" }),
    ]));
  });

  it("preserves generic 400 responses for malformed JSON and reload failures", async () => {
    let failReload = false;
    const logError = vi.fn();
    const handlers = createAccountsHandlers({
      database: {
        readPortfolioFacts: () => {
          if (failReload) throw new Error("synthetic reload failure");
          return {
            openingSnapshots: [],
            events: [],
            confirmedImports: [],
            confirmedSnapshots: [],
            state: buildPortfolioState({ openingSnapshots: [], events: [] }),
          };
        },
        readMarketData: () => ({
          observations: [],
          fxObservations: [],
          marketRefreshHistory: [],
          latestMarketRefresh: undefined,
        }),
        readSourceAccountLabels: () => ({}),
        renameSourceAccount: () => {
          failReload = true;
        },
      },
      now: () => "2026-09-14T12:00:00.000Z",
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
      logError,
    });

    const malformed = await handlers.PATCH(new Request("http://localhost/api/accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    }));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Account name could not be saved.",
    });

    const reloadFailure = await handlers.PATCH(new Request("http://localhost/api/accounts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "alipay-main", label: "Long-term savings" }),
    }));
    expect(reloadFailure.status).toBe(400);
    await expect(reloadFailure.json()).resolves.toEqual({
      error: "Account name could not be saved.",
    });
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenLastCalledWith(
      "Source Account rename failed",
      expect.any(Error),
    );
  });
});
