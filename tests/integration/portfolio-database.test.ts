import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createCsvImportDraft } from "@/application/imports/csv-import";
import type { PortfolioNarrativeReport } from "@/application/portfolio-narrative";
import { unknownDraftValue } from "@/domain/imports";
import {
  createPortfolioDatabase,
  LegacyPortfolioDatabaseError,
} from "@/infrastructure/sqlite/portfolio-repository";

const csv = `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,historical_cost_basis
alipay-main,Synthetic Index Fund,001234,fund,CNY,10,12.5,2026-07-16,10,125,25,100
`;

const narrative: PortfolioNarrativeReport = {
  id: "narrative-synthetic",
  provider: "openai",
  model: "gpt-synthetic",
  language: "en",
  generatedAt: "2026-09-05T12:30:00.000Z",
  portfolioAsOf: "2026-09-05T12:00:00.000Z",
  factsFingerprint: "v1-synthetic",
  headline: { text: "A factual headline", evidence: ["composition"] },
  overview: {
    text: "A factual overview.",
    evidence: ["composition", "holding-currency"],
  },
  observations: [{
    text: "The latest available move was small.",
    evidence: ["performance-today"],
  }],
  dataQuality: {
    text: "All valued data is current.",
    evidence: ["data-quality"],
  },
  provenance: [{
    key: "composition",
    label: "Portfolio composition",
    value: "1 investment across 1 account",
  }],
  disclaimer: "AI-generated factual summary · Not investment advice",
};

describe("Portfolio Database", () => {
  it("confirms a reviewed draft and its portfolio facts atomically", () => {
    const database = createPortfolioDatabase(":memory:");
    const draft = createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv,
    });
    database.saveImportDraft(draft);

    const invalidReview = structuredClone(draft);
    invalidReview.portfolio.holdings[0]!.quantity = unknownDraftValue();
    expect(() =>
      database.confirmImport({
        draftId: draft.id,
        confirmedImportId: "confirmed-csv",
        confirmedAt: "2026-07-19T10:01:00.000Z",
        review: {
          confidence: invalidReview.confidence,
          warnings: invalidReview.warnings,
          portfolio: invalidReview.portfolio,
        },
      }),
    ).toThrow("Holding 1 quantity is still unknown");

    expect(database.getImportDraft(draft.id)?.status).toBe("draft");
    expect(database.readPortfolioFacts().openingSnapshots).toEqual([]);

    database.confirmImport({
      draftId: draft.id,
      confirmedImportId: "confirmed-csv",
      confirmedAt: "2026-07-19T10:02:00.000Z",
      review: {
        confidence: draft.confidence,
        warnings: draft.warnings,
        portfolio: draft.portfolio,
      },
    });
    database.confirmImport({
      draftId: draft.id,
      confirmedImportId: "confirmed-csv",
      confirmedAt: "2026-07-19T10:03:00.000Z",
      review: {
        confidence: draft.confidence,
        warnings: draft.warnings,
        portfolio: draft.portfolio,
      },
    });

    const data = database.readPortfolioFacts();
    expect(database.getImportDraft(draft.id)).toMatchObject({
      status: "confirmed",
      confirmedAt: "2026-07-19T10:02:00.000Z",
    });
    expect(data.confirmedImports).toHaveLength(1);
    expect(data.openingSnapshots).toHaveLength(1);
    expect(data.state.positions[0]).toMatchObject({
      instrumentId: "001234",
      quantity: "10",
      costBasis: "100",
    });
    database.close();
  });

  it("rejects the disposable legacy schema instead of silently deleting it", () => {
    const directory = mkdtempSync(join(tmpdir(), "invest-monitor-schema-"));
    const filename = join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(filename);
    legacy.exec("CREATE TABLE import_drafts (id TEXT PRIMARY KEY)");
    legacy.close();

    try {
      expect(() => createPortfolioDatabase(filename)).toThrow(
        LegacyPortfolioDatabaseError,
      );
      expect(() => createPortfolioDatabase(filename)).toThrow(
        "Move or remove the test database, then re-import your CSV and Trading 212 data",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stores generated narratives separately from portfolio and market facts", () => {
    const database = createPortfolioDatabase(":memory:");
    expect(database.readLatestPortfolioNarrative()).toBeUndefined();

    database.savePortfolioNarrative(narrative);

    expect(database.readLatestPortfolioNarrative()).toEqual(narrative);
    expect(database.readPortfolioFacts().openingSnapshots).toEqual([]);
    expect(database.readMarketData().observations).toEqual([]);
    database.close();
  });

  it("returns the ten most recent market refresh runs with their trigger mode", () => {
    const database = createPortfolioDatabase(":memory:");
    for (let index = 0; index < 12; index += 1) {
      database.recordMarketData({
        observations: [],
        refresh: {
          mode: index % 2 === 0 ? "automatic" : "manual",
          provider: "synthetic-provider",
          completedAt: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
          updated: index,
          unchanged: 1,
          failed: 0,
          failures: [],
        },
      });
    }

    const marketData = database.readMarketData();
    expect(marketData.marketRefreshHistory).toHaveLength(10);
    expect(marketData.marketRefreshHistory!.map((run) => run.completedAt)).toEqual([
      "2026-09-12T10:00:00.000Z",
      "2026-09-11T10:00:00.000Z",
      "2026-09-10T10:00:00.000Z",
      "2026-09-09T10:00:00.000Z",
      "2026-09-08T10:00:00.000Z",
      "2026-09-07T10:00:00.000Z",
      "2026-09-06T10:00:00.000Z",
      "2026-09-05T10:00:00.000Z",
      "2026-09-04T10:00:00.000Z",
      "2026-09-03T10:00:00.000Z",
    ]);
    expect(marketData.latestMarketRefresh).toEqual(
      marketData.marketRefreshHistory![0],
    );
    database.close();
  });

  it("upgrades a v2 database in place without losing existing data", () => {
    const directory = mkdtempSync(join(tmpdir(), "invest-monitor-upgrade-"));
    const filename = join(directory, "portfolio.sqlite");
    const current = createPortfolioDatabase(filename);
    current.renameSourceAccount("trading212-main", "Synthetic broker");
    current.close();

    const previous = new DatabaseSync(filename);
    previous.exec(`
      ALTER TABLE opening_snapshots DROP COLUMN payload_scope;
      ALTER TABLE market_refresh_runs DROP COLUMN mode;
      DROP TABLE portfolio_narratives;
      UPDATE schema_metadata SET version = 2;
    `);
    previous.close();

    try {
      const upgraded = createPortfolioDatabase(filename);
      expect(upgraded.readSourceAccountLabels()).toEqual({
        "trading212-main": "Synthetic broker",
      });
      expect(upgraded.readLatestPortfolioNarrative()).toBeUndefined();
      upgraded.savePortfolioNarrative(narrative);
      expect(upgraded.readLatestPortfolioNarrative()).toEqual(narrative);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("upgrades a v7 database with dynamic accounts and preserves custom labels", () => {
    const directory = mkdtempSync(join(tmpdir(), "invest-monitor-v7-accounts-"));
    const filename = join(directory, "portfolio.sqlite");
    const current = createPortfolioDatabase(filename);
    current.renameSourceAccount("danske-main", "Retirement account");
    current.close();

    const previous = new DatabaseSync(filename);
    previous.exec(`
      DROP TABLE source_accounts;
      UPDATE schema_metadata SET version = 7;
    `);
    previous.close();

    try {
      const upgraded = createPortfolioDatabase(filename);
      expect(upgraded.readSourceAccounts().find((account) =>
        account.id === "danske-main"
      )).toMatchObject({
        accountType: "Danske Bank",
        label: "Retirement account",
        normalizedAccountType: "danskebank",
      });
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("upgrades v4 refresh runs in place and labels their unknown trigger", () => {
    const directory = mkdtempSync(join(tmpdir(), "invest-monitor-v4-refresh-"));
    const filename = join(directory, "portfolio.sqlite");
    const current = createPortfolioDatabase(filename);
    current.recordMarketData({
      observations: [],
      refresh: {
        mode: "manual",
        provider: "synthetic-provider",
        completedAt: "2026-09-05T10:00:00.000Z",
        updated: 1,
        unchanged: 0,
        failed: 1,
        failures: [{
          instrumentCode: "XX0000000001",
          category: "provider-error",
          message: "request failed for https://example.test?token=sensitive",
        }],
      },
    });
    current.close();

    const previous = new DatabaseSync(filename);
    previous.exec(`
      ALTER TABLE market_refresh_runs DROP COLUMN mode;
      UPDATE schema_metadata SET version = 4;
    `);
    previous.close();

    try {
      const upgraded = createPortfolioDatabase(filename);
      expect(upgraded.readMarketData().latestMarketRefresh).toMatchObject({
        mode: "unknown",
        provider: "synthetic-provider",
        completedAt: "2026-09-05T10:00:00.000Z",
        failures: [{
          instrumentCode: "Earlier run",
          category: "legacy-redacted",
          message: "Failure details from this earlier run were removed for privacy",
        }],
      });
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("upgrades v3 snapshot payload semantics without depending on warning copy at runtime", () => {
    const directory = mkdtempSync(join(tmpdir(), "invest-monitor-v3-upgrade-"));
    const filename = join(directory, "portfolio.sqlite");
    const current = createPortfolioDatabase(filename);
    const first = createCsvImportDraft({
      draftId: "draft-v3-first",
      snapshotId: "snapshot-v3-first",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: `${csv.trim()}\nalipay-main,Synthetic Bond Fund,006789,fund,CNY,10,10,2026-07-16,10,100,0,100\n`,
    });
    current.saveImportDraft(first);
    current.confirmImport({
      draftId: first.id,
      confirmedImportId: "confirmed-v3-first",
      confirmedAt: "2026-07-19T10:01:00.000Z",
      review: {
        confidence: first.confidence,
        warnings: first.warnings,
        portfolio: first.portfolio,
      },
    });
    const second = createCsvImportDraft({
      draftId: "draft-v3-second",
      snapshotId: "snapshot-v3-second",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-20T10:00:00.000Z",
      csv,
    });
    current.saveImportDraft(second);
    const savedSecond = current.getImportDraft(second.id)!;
    current.confirmImport({
      draftId: second.id,
      confirmedImportId: "confirmed-v3-second",
      confirmedAt: "2026-07-20T10:01:00.000Z",
      review: {
        confidence: savedSecond.confidence,
        warnings: savedSecond.warnings,
        portfolio: savedSecond.portfolio,
      },
    });
    const backdated = createCsvImportDraft({
      draftId: "draft-v3-backdated",
      snapshotId: "snapshot-v3-backdated",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-18T10:00:00.000Z",
      csv,
    });
    current.saveImportDraft(backdated);
    const savedBackdated = current.getImportDraft(backdated.id)!;
    current.confirmImport({
      draftId: backdated.id,
      confirmedImportId: "confirmed-v3-backdated",
      confirmedAt: "2026-07-21T10:01:00.000Z",
      review: {
        confidence: savedBackdated.confidence,
        warnings: savedBackdated.warnings,
        portfolio: savedBackdated.portfolio,
      },
    });
    current.close();

    const previous = new DatabaseSync(filename);
    const legacyPayload = JSON.parse((previous.prepare(
      "SELECT payload_json FROM opening_snapshots WHERE id = ?",
    ).get("snapshot-v3-second") as { payload_json: string }).payload_json) as {
      positions: Array<{ instrumentId: string }>;
    };
    legacyPayload.positions = legacyPayload.positions.filter(
      (position) => position.instrumentId === "001234",
    );
    previous.prepare(
      "UPDATE opening_snapshots SET payload_json = ? WHERE id = ?",
    ).run(JSON.stringify(legacyPayload), "snapshot-v3-second");
    previous.prepare(
      "UPDATE import_drafts SET warnings_json = '[]' WHERE id = ?",
    ).run("draft-v3-second");
    previous.prepare(
      "UPDATE import_drafts SET warnings_json = '[]' WHERE id = ?",
    ).run("draft-v3-backdated");
    previous.exec(`
      ALTER TABLE opening_snapshots DROP COLUMN payload_scope;
      ALTER TABLE market_refresh_runs DROP COLUMN mode;
      UPDATE schema_metadata SET version = 3;
    `);
    previous.close();

    try {
      const upgraded = createPortfolioDatabase(filename);
      expect(upgraded.readPortfolioFacts().state.positions.map(
        (position) => position.instrumentId,
      )).toEqual(["001234", "006789"]);
      upgraded.close();

      const migrated = new DatabaseSync(filename);
      expect(migrated.prepare(
        "SELECT payload_scope FROM opening_snapshots WHERE id = ?",
      ).get("snapshot-v3-second")).toEqual({ payload_scope: "legacy-partial" });
      expect(migrated.prepare(
        "SELECT payload_scope FROM opening_snapshots WHERE id = ?",
      ).get("snapshot-v3-backdated")).toEqual({ payload_scope: "complete" });
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
