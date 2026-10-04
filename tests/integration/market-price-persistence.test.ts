import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("market price persistence", () => {
  it("migrates v8 and stores a confirmed source binding without changing holdings", () => {
    const directory = mkdtempSync(join(tmpdir(), "price-source-binding-"));
    const filename = join(directory, "portfolio.sqlite");
    try {
      createPortfolioDatabase(filename).close();
      const previous = new DatabaseSync(filename);
      previous.exec("DROP TABLE price_source_bindings; UPDATE schema_metadata SET version = 8");
      previous.close();

      const database = createPortfolioDatabase(filename);
      const binding = {
        sourceAccountId: "synthetic-wechat",
        instrumentId: "synthetic-fund",
        instrumentName: "Synthetic fund C",
        instrumentCode: "012414",
        currency: "CNY",
        shareClass: "C",
        provider: "eastmoney" as const,
        identityUrl: "https://example.test/fund",
        confirmedAt: "2026-10-04T00:00:00.000Z",
      };
      database.savePriceSourceBinding(binding);
      expect(database.readPriceSourceBindings()).toEqual([binding]);
      database.recordMarketData({ observations: [{
        sourceAccountId: binding.sourceAccountId,
        instrumentId: binding.instrumentId,
        instrumentCode: binding.instrumentCode,
        price: "0.5",
        currency: "CNY",
        asOf: "2026-10-03",
        recordedAt: "2026-10-04T09:00:00.000Z",
        source: "eastmoney",
      }], priceSourceStatuses: [{
        sourceAccountId: binding.sourceAccountId,
        instrumentId: binding.instrumentId,
        instrumentCode: binding.instrumentCode,
        provider: "eastmoney",
        checkedAt: "2026-10-04T09:00:00.000Z",
        outcome: "updated",
        latestPriceAsOf: "2026-10-03",
      }] });
      expect(database.readPriceSourceBindings()[0]?.lastRefresh).toEqual({
        checkedAt: "2026-10-04T09:00:00.000Z",
        outcome: "updated",
        latestPriceAsOf: "2026-10-03",
      });
      database.recordMarketData({ observations: [], priceSourceStatuses: [{
        sourceAccountId: binding.sourceAccountId,
        instrumentId: binding.instrumentId,
        instrumentCode: binding.instrumentCode,
        provider: "eastmoney",
        checkedAt: "2026-10-04T10:00:00.000Z",
        outcome: "failed",
        failureCategory: "timeout",
      }] });
      expect(database.readPortfolioFacts().state.positions).toEqual([]);
      database.close();

      const reopened = createPortfolioDatabase(filename);
      expect(reopened.readPriceSourceBindings()).toEqual([{ ...binding, lastRefresh: {
        checkedAt: "2026-10-04T10:00:00.000Z",
        outcome: "failed",
        latestPriceAsOf: "2026-10-03",
        failureCategory: "timeout",
      } }]);
      expect(reopened.readMarketData().observations).toHaveLength(1);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("upgrades a version 9 binding table without losing a confirmed source", () => {
    const directory = mkdtempSync(join(tmpdir(), "price-source-v9-"));
    const filename = join(directory, "portfolio.sqlite");
    try {
      createPortfolioDatabase(filename).close();
      const previous = new DatabaseSync(filename);
      previous.exec(`
        DROP TABLE price_source_bindings;
        CREATE TABLE price_source_bindings (
          source_account_id TEXT NOT NULL, instrument_id TEXT NOT NULL,
          instrument_name TEXT NOT NULL, instrument_code TEXT NOT NULL,
          currency TEXT NOT NULL, share_class TEXT NOT NULL,
          provider TEXT NOT NULL, identity_url TEXT NOT NULL,
          confirmed_at TEXT NOT NULL,
          PRIMARY KEY (source_account_id, instrument_id)
        );
        INSERT INTO price_source_bindings VALUES (
          'synthetic-wechat', 'fund', 'Fund C', '012414', 'CNY', 'C',
          'eastmoney', 'https://example.test/fund', '2026-10-04T00:00:00.000Z'
        );
        UPDATE schema_metadata SET version = 9;
      `);
      previous.close();
      const database = createPortfolioDatabase(filename);
      expect(database.readPriceSourceBindings()).toMatchObject([{
        instrumentId: "fund", instrumentCode: "012414",
      }]);
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stores price observations separately from confirmed holding snapshots", () => {
    const database = createPortfolioDatabase(":memory:");
    const observation = {
      sourceAccountId: "alipay-main",
      instrumentId: "alipay-main:040046",
      instrumentCode: "040046",
      price: "8.253",
      currency: "CNY",
      asOf: "2026-07-17",
      recordedAt: "2026-07-19T14:00:00.000Z",
      source: "eastmoney",
    };

    database.recordMarketData({
      observations: [observation],
      refresh: {
        mode: "manual",
        provider: "eastmoney",
        completedAt: "2026-07-19T14:01:00.000Z",
        updated: 0,
        unchanged: 5,
        failed: 1,
        failures: [{
          instrumentCode: "270042",
          category: "provider-error",
          message: "upstream unavailable",
          sourceAccountId: "alipay-main",
          instrumentId: "fund-1",
          retryCount: 1,
        }],
      },
    });

    const data = database.readMarketData();
    expect(data.observations).toEqual([observation]);
    expect(data.latestMarketRefresh).toEqual({
      mode: "manual",
      provider: "eastmoney",
      completedAt: "2026-07-19T14:01:00.000Z",
      updated: 0,
      unchanged: 5,
      failed: 1,
      failures: [{
        instrumentCode: "270042",
        category: "provider-error",
        message: "upstream unavailable",
        sourceAccountId: "alipay-main",
        instrumentId: "fund-1",
        retryCount: 1,
      }],
    });
    expect(data.marketRefreshHistory).toEqual([data.latestMarketRefresh]);
    expect(database.readPortfolioFacts().openingSnapshots).toEqual([]);
    expect(database.readPortfolioFacts().state.positions).toEqual([]);
    database.close();
  });

  it("stores dated ECB FX observations idempotently for historical valuation", () => {
    const database = createPortfolioDatabase(":memory:");
    const firstFetch = {
      currency: "CNY",
      eurPerUnit: "0.12",
      asOf: "2026-07-20",
      recordedAt: "2026-07-21T08:00:00.000Z",
      source: "ecb",
    };
    const repeatedFetch = {
      ...firstFetch,
      recordedAt: "2026-07-21T09:00:00.000Z",
    };

    database.recordMarketData({
      observations: [],
      fxObservations: [firstFetch],
    });
    database.recordMarketData({
      observations: [],
      fxObservations: [repeatedFetch],
    });

    expect(database.readMarketData().fxObservations).toEqual([repeatedFetch]);
    database.close();
  });
});
