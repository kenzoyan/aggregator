import { describe, expect, it, vi } from "vitest";

import {
  createImportConfirmHandler,
} from "@/app/api/imports/[id]/confirm/handler";
import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import {
  draftPortfolioFromOpeningSnapshot,
  prepareImportDraftForReview,
  type StoredImportDraft,
} from "@/domain/imports";

describe("POST /api/imports/:id/confirm", () => {
  it("returns the existing not-found response without attempting confirmation", async () => {
    const confirmImport = vi.fn();
    const response = await createImportConfirmHandler({
      database: {
        getImportDraft: () => undefined,
        confirmImport,
      },
      newId: () => "unused",
      now: () => "2026-07-21T00:01:00.000Z",
    })(new Request("http://localhost/api/imports/missing/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confidence: "high",
        warnings: [],
        portfolio: {
          snapshotId: "snapshot-missing",
          asOf: "2026-07-21T00:00:00.000Z",
          holdings: [],
          portfolioCash: { amount: "0", currency: "EUR" },
        },
      }),
    }), "missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Import draft not found." });
    expect(confirmImport).not.toHaveBeenCalled();
  });

  it("preserves validation paths and messages for empty and malformed reviews", async () => {
    const stored: StoredImportDraft = {
      id: "draft",
      sourceAccountId: "manual-main",
      sourceKind: "manual",
      createdAt: "2026-07-21T00:00:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-empty",
        sourceAccountId: "manual-main",
        asOf: "2026-07-21T00:00:00.000Z",
        positions: [],
      }, "manual"),
      status: "draft",
    };
    const handler = createImportConfirmHandler({
      database: {
        getImportDraft: () => stored,
        confirmImport: vi.fn(),
      },
      newId: () => "unused",
      now: () => "2026-07-21T00:01:00.000Z",
    });

    const emptyResponse = await handler(new Request(
      "http://localhost/api/imports/draft/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confidence: "high",
          warnings: [],
          portfolio: {
            snapshotId: "snapshot-empty",
            asOf: "2026-07-21T00:00:00.000Z",
            holdings: [],
          },
        }),
      },
    ), "draft");
    expect(emptyResponse.status).toBe(400);
    await expect(emptyResponse.json()).resolves.toEqual({
      error: "Add at least one holding or a portfolio cash balance.",
      fieldErrors: {
        "portfolio.holdings": "Add at least one holding or a portfolio cash balance.",
      },
    });

    const malformedResponse = await handler(new Request(
      "http://localhost/api/imports/draft/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confidence: "high",
          warnings: [],
          portfolio: {
            snapshotId: "",
            asOf: "not-a-date",
            holdings: [],
          },
        }),
      },
    ), "draft");
    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toMatchObject({
      fieldErrors: {
        "portfolio.snapshotId": "Too small: expected string to have >=1 characters",
        "portfolio.asOf": "Invalid ISO datetime",
        "portfolio.holdings": "Add at least one holding or a portfolio cash balance.",
      },
    });
  });

  it("explains the exact inconsistent holding values instead of returning a generic 400", async () => {
    const request = new Request("http://localhost/api/imports/draft/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confidence: "high",
        warnings: [],
        portfolio: {
          snapshotId: "snapshot-second-day",
          asOf: "2026-07-21T00:00:00.000Z",
          holdings: [{
            lineId: "holding-1",
            instrumentId: "FIXTURE-FUND",
            displayName: "Synthetic Validation Fund",
            instrumentCode: "FIXTURE-FUND",
            assetType: "fund",
            quantity: "2",
            currency: "CNY",
            costBasis: "200",
            reportedPriorReturn: "25",
            averageCost: "100",
            observedPrice: "110",
            priceAsOf: "2026-07-20T00:00:00.000Z",
            reportedMarketValue: "225",
          }],
        },
      }),
    });

    const stored: StoredImportDraft = {
      id: "draft",
      sourceAccountId: "alipay-main",
      sourceKind: "manual",
      createdAt: "2026-07-21T00:00:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-second-day",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-21T00:00:00.000Z",
        positions: [{
          instrumentId: "FIXTURE-FUND",
          quantity: "2",
          currency: "CNY",
          costBasis: "200",
          reportedPriorReturn: "25",
          observedPrice: "110",
          reportedMarketValue: "220",
        }],
      }, "manual"),
      status: "draft",
    };
    const response = await createImportConfirmHandler({
      database: {
        getImportDraft: () => stored,
        confirmImport: vi.fn(),
      },
      newId: () => "unused",
      now: () => "2026-07-21T00:01:00.000Z",
    })(request, "draft");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Quantity × price is 220.00 CNY, but current value is 225.00 CNY.",
      fieldErrors: {
        "portfolio.holdings.0.observedPrice":
          "Quantity × price is 220.00 CNY, but current value is 225.00 CNY.",
      },
    });
  });

  it("explains the cost-basis mismatch after current value is corrected to quantity × price", async () => {
    const request = new Request("http://localhost/api/imports/draft/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confidence: "high",
        warnings: [],
        portfolio: {
          snapshotId: "snapshot-second-day",
          asOf: "2026-07-21T00:00:00.000Z",
          holdings: [{
            lineId: "holding-1",
            instrumentId: "FIXTURE-FUND",
            quantity: "2",
            currency: "CNY",
            costBasis: "200",
            reportedPriorReturn: "25",
            observedPrice: "110",
            reportedMarketValue: "220",
          }],
        },
      }),
    });

    const stored: StoredImportDraft = {
      id: "draft",
      sourceAccountId: "alipay-main",
      sourceKind: "manual",
      createdAt: "2026-07-21T00:00:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-second-day",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-21T00:00:00.000Z",
        positions: [{
          instrumentId: "FIXTURE-FUND",
          quantity: "2",
          currency: "CNY",
          costBasis: "200",
          reportedPriorReturn: "25",
          observedPrice: "110",
          reportedMarketValue: "220",
        }],
      }, "manual"),
      status: "draft",
    };
    const response = await createImportConfirmHandler({
      database: {
        getImportDraft: () => stored,
        confirmImport: vi.fn(),
      },
      newId: () => "unused",
      now: () => "2026-07-21T00:01:00.000Z",
    })(request, "draft");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cost basis + prior return is 225.00 CNY, but current value is 220.00 CNY.",
      fieldErrors: {
        "portfolio.holdings.0.reportedMarketValue":
          "Cost basis + prior return is 225.00 CNY, but current value is 220.00 CNY.",
      },
    });
  });

  it("allows a tracked Trading 212 holding's frozen prior return beside a newer price", async () => {
    const currentState = {
      positions: [{
        sourceAccountId: "trading212-main",
        instrumentId: "TRACKED-ETF",
        displayName: "Synthetic Tracked ETF",
        instrumentCode: "IE00TRACKED",
        assetType: "etf" as const,
        quantity: "0.2",
        currency: "EUR",
        costBasis: "100",
        reportedPriorReturn: "-3.68",
        observedPrice: "481.6",
        priceAsOf: "2026-08-30T12:00:00.000Z",
        reportedMarketValue: "96.32",
      }],
      cashBalances: [{
        sourceAccountId: "trading212-main",
        amount: "0",
        currency: "EUR",
      }],
      appliedEventIds: [],
    };
    const prepared = prepareImportDraftForReview({
      id: "draft-trading-change",
      sourceAccountId: "trading212-main",
      sourceKind: "trading-212",
      createdAt: "2026-09-05T12:00:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-trading-change",
        sourceAccountId: "trading212-main",
        asOf: "2026-09-05T12:00:00.000Z",
        portfolioCash: { amount: "300", currency: "EUR" },
        positions: [
          {
            instrumentId: "TRACKED-ETF",
            displayName: "Synthetic Tracked ETF",
            instrumentCode: "IE00TRACKED",
            assetType: "etf",
            quantity: "0.2",
            currency: "EUR",
            costBasis: "100",
            reportedPriorReturn: "-2.75",
            observedPrice: "486.25",
            priceAsOf: "2026-09-05T12:00:00.000Z",
            reportedMarketValue: "97.25",
          },
          {
            instrumentId: "NEW-ETF",
            displayName: "Synthetic New ETF",
            instrumentCode: "IE00NEWETF",
            assetType: "etf",
            quantity: "0.1",
            currency: "EUR",
            costBasis: "50",
            reportedPriorReturn: "0.38",
            observedPrice: "503.8",
            priceAsOf: "2026-09-05T12:00:00.000Z",
            reportedMarketValue: "50.38",
          },
        ],
      }, "api"),
    }, currentState);
    const stored: StoredImportDraft = { ...prepared, status: "draft" };
    const editable = createImportDraftReadModel(stored);
    const confirmImport = vi.fn(() => ({
      ...stored,
      status: "confirmed" as const,
      confirmedAt: "2026-09-05T12:01:00.000Z",
    }));
    const handler = createImportConfirmHandler({
      database: {
        getImportDraft: () => stored,
        confirmImport,
      },
      newId: () => "confirmed-import",
      now: () => "2026-09-05T12:01:00.000Z",
    });
    const request = new Request(
      "http://localhost/api/imports/draft-trading-change/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confidence: editable.confidence,
          warnings: editable.warnings,
          portfolio: editable.portfolio,
        }),
      },
    );

    const response = await handler(request, "draft-trading-change");

    expect(response.status).toBe(200);
    expect(confirmImport).toHaveBeenCalledOnce();

    const invalidNewHolding = structuredClone(editable);
    invalidNewHolding.portfolio.holdings[1]!.reportedPriorReturn = "0";
    const invalidResponse = await handler(new Request(
      "http://localhost/api/imports/draft-trading-change/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confidence: invalidNewHolding.confidence,
          warnings: invalidNewHolding.warnings,
          portfolio: invalidNewHolding.portfolio,
        }),
      },
    ), "draft-trading-change");
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: "Cost basis + prior return is 50.00 EUR, but current value is 50.38 EUR.",
    });
    expect(confirmImport).toHaveBeenCalledOnce();
  });
});
