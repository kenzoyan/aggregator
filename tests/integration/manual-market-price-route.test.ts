import { describe, expect, it, vi } from "vitest";

import { createManualMarketPriceHandler } from "@/app/api/market-data/manual/route";
import { createHoldingHistoryReadModel } from "@/application/holding-history";
import { createCsvImportDraft } from "@/application/imports/csv-import";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("POST /api/market-data/manual", () => {
  it("records a dated price for an existing holding without changing Holding State", async () => {
    const recordMarketData = vi.fn();
    const handler = createManualMarketPriceHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state: {
            positions: [{
              sourceAccountId: "alipay-main",
              instrumentId: "fixture-fund",
              instrumentCode: "FIXTURE-FUND",
              displayName: "Synthetic Fund",
              assetType: "fund",
              quantity: "2",
              currency: "CNY",
              costBasis: "160",
              reportedPriorReturn: "40",
            }],
            cashBalances: [],
            appliedEventIds: [],
          },
        }),
        recordMarketData,
      },
      now: () => "2026-07-23T09:30:00.000Z",
    });

    const response = await handler(new Request("http://localhost/api/market-data/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceAccountId: "alipay-main",
        instrumentId: "fixture-fund",
        price: "12.5",
        asOf: "2026-07-22",
      }),
    }));

    expect(response.status).toBe(200);
    expect(recordMarketData).toHaveBeenCalledWith({
      observations: [{
        sourceAccountId: "alipay-main",
        instrumentId: "fixture-fund",
        instrumentCode: "FIXTURE-FUND",
        price: "12.5",
        currency: "CNY",
        asOf: "2026-07-22",
        recordedAt: "2026-07-23T09:30:00.000Z",
        source: "manual",
      }],
    });
    await expect(response.json()).resolves.toMatchObject({
      observation: {
        instrumentId: "fixture-fund",
        price: "12.5",
        asOf: "2026-07-22",
      },
    });
  });

  it("turns a second dated manual price into holding history while preserving the stored position", async () => {
    const database = createPortfolioDatabase(":memory:");
    const draft = createCsvImportDraft({
      draftId: "manual-price-baseline-draft",
      snapshotId: "manual-price-baseline-snapshot",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-22T09:00:00.000Z",
      csv: `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,historical_cost_basis
alipay-main,Synthetic Fund,FIXTURE-FUND,fund,EUR,2,100,2026-07-22,100,200,0,200
alipay-main,Unaffected Fund,UNAFFECTED-FUND,fund,EUR,3,50,2026-07-22,40,150,30,120
`,
    });
    database.saveImportDraft(draft);
    const savedDraft = database.getImportDraft(draft.id)!;
    database.confirmImport({
      draftId: savedDraft.id,
      confirmedImportId: "manual-price-baseline-confirmed",
      confirmedAt: "2026-07-22T09:01:00.000Z",
      review: {
        confidence: savedDraft.confidence,
        warnings: savedDraft.warnings,
        portfolio: savedDraft.portfolio,
      },
    });
    const stateBefore = structuredClone(database.readPortfolioFacts().state);
    const handler = createManualMarketPriceHandler({
      database,
      now: () => "2026-07-23T18:00:00.000Z",
    });

    const response = await handler(new Request("http://localhost/api/market-data/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceAccountId: "alipay-main",
        instrumentId: "FIXTURE-FUND",
        price: "110",
        asOf: "2026-07-23",
      }),
    }));

    expect(response.status).toBe(200);
    const facts = database.readPortfolioFacts();
    expect(facts.state).toEqual(stateBefore);
    expect(facts.state.positions.find((position) =>
      position.instrumentId === "UNAFFECTED-FUND"
    )).toEqual(stateBefore.positions.find((position) =>
      position.instrumentId === "UNAFFECTED-FUND"
    ));
    const history = createHoldingHistoryReadModel({
      state: facts.state,
      snapshots: facts.openingSnapshots,
      marketPrices: database.readMarketData().observations,
      fxObservations: [],
      asOf: "2026-07-23T23:59:59.999Z",
    });
    expect(history["alipay-main:FIXTURE-FUND"].today).toMatchObject({
      available: true,
      change: 20,
      percent: 10,
      points: [200, 220],
      baselineAsOf: "2026-07-22T23:59:59.999Z",
      currentAsOf: "2026-07-23T23:59:59.999Z",
    });
    database.close();
  });

  it("accepts the Helsinki calendar date after local midnight", async () => {
    const recordMarketData = vi.fn();
    const handler = createManualMarketPriceHandler({
      database: {
        readPortfolioFacts: () => ({
          openingSnapshots: [],
          events: [],
          confirmedImports: [],
          confirmedSnapshots: [],
          state: {
            positions: [{
              sourceAccountId: "fixture-account",
              instrumentId: "fixture-fund",
              quantity: "1",
              currency: "EUR",
              costBasis: "10",
              reportedPriorReturn: "0",
            }],
            cashBalances: [],
            appliedEventIds: [],
          },
        }),
        recordMarketData,
      },
      now: () => "2026-07-22T21:30:00.000Z",
    });

    const response = await handler(new Request("http://localhost/api/market-data/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceAccountId: "fixture-account",
        instrumentId: "fixture-fund",
        price: "11",
        asOf: "2026-07-23",
      }),
    }));

    expect(response.status).toBe(200);
    expect(recordMarketData).toHaveBeenCalledOnce();
  });
});
