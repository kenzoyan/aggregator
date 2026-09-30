import { describe, expect, it, vi } from "vitest";

import { createAccountsHandlers } from "@/app/api/accounts/handler";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import {
  createSourceAccountDefinition,
  SourceAccountDeletionError,
  sourceAccounts,
  type SourceAccountDefinition,
} from "@/domain/source-accounts";

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
    const accounts = [...sourceAccounts];
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => accounts,
        createSourceAccount: vi.fn(),
        deleteSourceAccount: vi.fn(),
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
    expect(payload.holdings).toEqual([expect.objectContaining({
      id: "alipay-main:synthetic-fund",
      sourceAccountId: "alipay-main",
      instrumentId: "synthetic-fund",
      name: "Synthetic Fund",
      symbol: "000001",
      category: "Fund",
      quantity: "10",
      currency: "EUR",
      eurValue: 110,
    })]);
    expect(renameSourceAccount).not.toHaveBeenCalled();
  });

  it("renames an account and returns the refreshed accounts page", async () => {
    const labels: Record<string, string> = {};
    const accounts = [...sourceAccounts];
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => accounts,
        createSourceAccount: vi.fn(),
        deleteSourceAccount: vi.fn(),
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
    const accounts = [...sourceAccounts];
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => accounts,
        createSourceAccount: vi.fn(),
        deleteSourceAccount: vi.fn(),
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

  it("creates an arbitrary account type and returns the refreshed accounts page", async () => {
    const accounts: SourceAccountDefinition[] = [...sourceAccounts];
    const createSourceAccount = vi.fn((account: {
      id: string;
      accountType: string;
      label?: string;
    }) => {
      const created = createSourceAccountDefinition(account);
      accounts.push(created);
      return created;
    });
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => accounts,
        createSourceAccount,
        deleteSourceAccount: vi.fn(),
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
        readSourceAccountLabels: () => ({}),
        renameSourceAccount: vi.fn(),
      },
      newId: () => "account-nordea",
      now: () => "2026-09-14T12:00:00.000Z",
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
    });

    const response = await handlers.POST(new Request("http://localhost/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountType: "Nordea", label: "Brokerage" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(createSourceAccount).toHaveBeenCalledWith({
      id: "account-nordea",
      accountType: "Nordea",
      label: "Brokerage",
    });
    expect(payload.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "account-nordea",
        provider: "generic",
        label: "Brokerage",
        status: "not-connected",
      }),
    ]));
  });

  it("reuses the stable id when a known account type is recreated", async () => {
    const accounts: SourceAccountDefinition[] = sourceAccounts.filter(
      (account) => account.id !== "wechat-main",
    );
    const createSourceAccount = vi.fn((account: {
      id: string;
      accountType: string;
      label?: string;
    }) => {
      const created = createSourceAccountDefinition(account);
      accounts.push(created);
      return created;
    });
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => accounts,
        createSourceAccount,
        deleteSourceAccount: vi.fn(),
        readPortfolioFacts: () => ({
          openingSnapshots: [], events: [], confirmedImports: [], confirmedSnapshots: [],
          state: buildPortfolioState({ openingSnapshots: [], events: [] }),
        }),
        readMarketData: () => ({
          observations: [], fxObservations: [], marketRefreshHistory: [], latestMarketRefresh: undefined,
        }),
        readSourceAccountLabels: () => ({}),
        renameSourceAccount: vi.fn(),
      },
      newId: () => "account-random",
      now: () => "2026-09-16T12:00:00.000Z",
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
    });

    const response = await handlers.POST(new Request("http://localhost/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountType: "WeChat Wealth Management" }),
    }));

    expect(response.status).toBe(201);
    expect(createSourceAccount).toHaveBeenCalledWith({
      id: "wechat-main",
      accountType: "WeChat Wealth Management",
    });
  });

  it("rejects duplicate normalized account types with a conflict", async () => {
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => [...sourceAccounts],
        createSourceAccount: () => {
          throw new Error("Source Account type already exists");
        },
        deleteSourceAccount: vi.fn(),
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
        readSourceAccountLabels: () => ({}),
        renameSourceAccount: vi.fn(),
      },
      newId: () => "unused-id",
      now: () => "2026-09-14T12:00:00.000Z",
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
    });

    const response = await handlers.POST(new Request("http://localhost/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountType: " trading 212 " }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An account of this type already exists.",
    });
  });

  it("deletes an empty custom account and returns the refreshed accounts page", async () => {
    const accounts: SourceAccountDefinition[] = [
      ...sourceAccounts,
      createSourceAccountDefinition({ id: "account-nordea", accountType: "Nordea" }),
    ];
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => accounts,
        createSourceAccount: vi.fn(),
        deleteSourceAccount: (id) => {
          const index = accounts.findIndex((account) => account.id === id);
          if (index >= 0) accounts.splice(index, 1);
        },
        readPortfolioFacts: () => ({
          openingSnapshots: [], events: [], confirmedImports: [], confirmedSnapshots: [],
          state: buildPortfolioState({ openingSnapshots: [], events: [] }),
        }),
        readMarketData: () => ({
          observations: [], fxObservations: [], marketRefreshHistory: [], latestMarketRefresh: undefined,
        }),
        readSourceAccountLabels: () => ({}),
        renameSourceAccount: vi.fn(),
      },
      now: () => "2026-09-16T12:00:00.000Z",
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
    });

    const response = await handlers.DELETE(new Request("http://localhost/api/accounts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "account-nordea" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.accounts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "account-nordea" }),
    ]));
  });

  it("returns a conflict instead of deleting an account with portfolio data", async () => {
    const handlers = createAccountsHandlers({
      database: {
        readSourceAccounts: () => [...sourceAccounts],
        createSourceAccount: vi.fn(),
        deleteSourceAccount: () => {
          throw new SourceAccountDeletionError("has-data");
        },
        readPortfolioFacts: () => ({
          openingSnapshots: [], events: [], confirmedImports: [], confirmedSnapshots: [],
          state: buildPortfolioState({ openingSnapshots: [], events: [] }),
        }),
        readMarketData: () => ({
          observations: [], fxObservations: [], marketRefreshHistory: [], latestMarketRefresh: undefined,
        }),
        readSourceAccountLabels: () => ({}),
        renameSourceAccount: vi.fn(),
      },
      isTrading212Configured: () => false,
      trading212Environment: () => "demo",
    });

    const response = await handlers.DELETE(new Request("http://localhost/api/accounts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "account-with-data" }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Remove or transfer this account's portfolio data before deleting it.",
    });
  });
});
