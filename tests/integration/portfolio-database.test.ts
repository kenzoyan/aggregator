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

  it("upgrades a v2 database in place without losing existing data", () => {
    const directory = mkdtempSync(join(tmpdir(), "invest-monitor-upgrade-"));
    const filename = join(directory, "portfolio.sqlite");
    const current = createPortfolioDatabase(filename);
    current.renameSourceAccount("trading212-main", "Synthetic broker");
    current.close();

    const previous = new DatabaseSync(filename);
    previous.exec(`
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
});
