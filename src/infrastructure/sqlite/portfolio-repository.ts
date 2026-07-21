import { DatabaseSync } from "node:sqlite";

import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type { ImportSourceKind } from "@/domain/imports";
import type {
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type {
  OpeningSnapshotInput,
  PortfolioEventInput,
  PortfolioState,
} from "@/domain/portfolio/types";
import { findSourceAccount } from "@/domain/source-accounts";

export interface ImportDraftInput {
  id: string;
  sourceAccountId: string;
  sourceKind: ImportSourceKind;
  createdAt: string;
  confidence: string;
  warnings: readonly string[];
  proposedOpeningSnapshot: OpeningSnapshotInput;
}

export interface StoredImportDraft extends ImportDraftInput {
  status: "draft" | "confirmed";
  confirmedAt?: string;
}

export interface ImportDraftReview {
  confidence: string;
  warnings: readonly string[];
  proposedOpeningSnapshot: OpeningSnapshotInput;
}

export interface ConfirmedSnapshotRecord {
  snapshot: OpeningSnapshotInput;
  confirmedAt: string;
}

interface ImportDraftRow {
  id: string;
  source_account_id: string;
  source_kind: ImportDraftInput["sourceKind"];
  created_at: string;
  confidence: string;
  warnings_json: string;
  proposed_snapshot_json: string;
  status: StoredImportDraft["status"];
  confirmed_at: string | null;
}

interface FactRow {
  payload_json: string;
}

export interface PortfolioRepository {
  createImportDraft(draft: ImportDraftInput): void;
  getImportDraft(id: string): StoredImportDraft | undefined;
  updateImportDraft(id: string, review: ImportDraftReview): void;
  confirmImportDraft(id: string, confirmedAt: string): void;
  getOpeningSnapshots(): OpeningSnapshotInput[];
  getConfirmedSnapshots(): ConfirmedSnapshotRecord[];
  saveMarketPriceObservations(
    observations: readonly MarketPriceObservation[],
  ): void;
  getMarketPriceObservations(): MarketPriceObservation[];
  saveMarketRefreshRecord(record: MarketRefreshRecord): void;
  getLatestMarketRefreshRecord(): MarketRefreshRecord | undefined;
  getSourceAccountLabels(): Record<string, string>;
  renameSourceAccount(id: string, label: string): void;
  getPortfolioState(): PortfolioState;
  close(): void;
}

function decodeDraft(row: ImportDraftRow): StoredImportDraft {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    sourceKind: row.source_kind,
    createdAt: row.created_at,
    confidence: row.confidence,
    warnings: JSON.parse(row.warnings_json) as string[],
    proposedOpeningSnapshot: JSON.parse(
      row.proposed_snapshot_json,
    ) as OpeningSnapshotInput,
    status: row.status,
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}),
  };
}

export function createPortfolioRepository(
  filename: string,
): PortfolioRepository {
  const database = new DatabaseSync(filename);

  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS import_drafts (
      id TEXT PRIMARY KEY,
      source_account_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confidence TEXT NOT NULL,
      warnings_json TEXT NOT NULL,
      proposed_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed')),
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS opening_snapshots (
      id TEXT PRIMARY KEY,
      source_account_id TEXT NOT NULL,
      as_of TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      import_draft_id TEXT UNIQUE,
      FOREIGN KEY (import_draft_id) REFERENCES import_drafts(id)
    );

    CREATE TABLE IF NOT EXISTS portfolio_events (
      id TEXT PRIMARY KEY,
      source_account_id TEXT NOT NULL,
      as_of TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_price_observations (
      source_account_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      instrument_code TEXT NOT NULL,
      price TEXT NOT NULL,
      currency TEXT NOT NULL,
      as_of TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (source_account_id, instrument_id, as_of, source)
    );

    CREATE TABLE IF NOT EXISTS market_refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      updated_count INTEGER NOT NULL,
      unchanged_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      failures_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS source_account_labels (
      source_account_id TEXT PRIMARY KEY,
      custom_label TEXT NOT NULL
    );
  `);

  const marketRefreshColumns = database.prepare(
    "PRAGMA table_info(market_refresh_runs)",
  ).all() as unknown as Array<{ name: string }>;
  if (!marketRefreshColumns.some((column) => column.name === "failures_json")) {
    database.exec(
      "ALTER TABLE market_refresh_runs ADD COLUMN failures_json TEXT NOT NULL DEFAULT '[]'",
    );
  }

  const insertDraft = database.prepare(`
    INSERT INTO import_drafts (
      id,
      source_account_id,
      source_kind,
      created_at,
      confidence,
      warnings_json,
      proposed_snapshot_json,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `);
  const selectDraft = database.prepare(`
    SELECT * FROM import_drafts WHERE id = ?
  `);
  const updateDraft = database.prepare(`
    UPDATE import_drafts
    SET confidence = ?, warnings_json = ?, proposed_snapshot_json = ?
    WHERE id = ? AND status = 'draft'
  `);
  const insertSnapshot = database.prepare(`
    INSERT OR IGNORE INTO opening_snapshots (
      id,
      source_account_id,
      as_of,
      payload_json,
      import_draft_id
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const markDraftConfirmed = database.prepare(`
    UPDATE import_drafts
    SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?)
    WHERE id = ?
  `);
  const selectSnapshots = database.prepare(`
    SELECT opening_snapshots.payload_json
    FROM opening_snapshots
    LEFT JOIN import_drafts ON import_drafts.id = opening_snapshots.import_draft_id
    ORDER BY
      opening_snapshots.as_of,
      COALESCE(import_drafts.confirmed_at, ''),
      opening_snapshots.rowid
  `);
  const selectConfirmedSnapshots = database.prepare(`
    SELECT opening_snapshots.payload_json, import_drafts.confirmed_at
    FROM opening_snapshots
    JOIN import_drafts ON import_drafts.id = opening_snapshots.import_draft_id
    WHERE import_drafts.confirmed_at IS NOT NULL
    ORDER BY import_drafts.confirmed_at, opening_snapshots.rowid
  `);
  const selectEvents = database.prepare(`
    SELECT payload_json
    FROM portfolio_events
    ORDER BY as_of, id
  `);
  const upsertMarketPrice = database.prepare(`
    INSERT INTO market_price_observations (
      source_account_id,
      instrument_id,
      instrument_code,
      price,
      currency,
      as_of,
      recorded_at,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_account_id, instrument_id, as_of, source) DO UPDATE SET
      instrument_code = excluded.instrument_code,
      price = excluded.price,
      currency = excluded.currency,
      recorded_at = excluded.recorded_at
  `);
  const selectMarketPrices = database.prepare(`
    SELECT
      source_account_id,
      instrument_id,
      instrument_code,
      price,
      currency,
      as_of,
      recorded_at,
      source
    FROM market_price_observations
    ORDER BY recorded_at, as_of, rowid
  `);
  const insertMarketRefresh = database.prepare(`
    INSERT INTO market_refresh_runs (
      provider,
      completed_at,
      updated_count,
      unchanged_count,
      failed_count,
      failures_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectLatestMarketRefresh = database.prepare(`
    SELECT provider, completed_at, updated_count, unchanged_count, failed_count, failures_json
    FROM market_refresh_runs
    ORDER BY completed_at DESC, id DESC
    LIMIT 1
  `);
  const selectAccountLabels = database.prepare(`
    SELECT source_account_id, custom_label
    FROM source_account_labels
    ORDER BY source_account_id
  `);
  const upsertAccountLabel = database.prepare(`
    INSERT INTO source_account_labels (source_account_id, custom_label)
    VALUES (?, ?)
    ON CONFLICT(source_account_id) DO UPDATE SET custom_label = excluded.custom_label
  `);

  return {
    createImportDraft(draft) {
      insertDraft.run(
        draft.id,
        draft.sourceAccountId,
        draft.sourceKind,
        draft.createdAt,
        draft.confidence,
        JSON.stringify(draft.warnings),
        JSON.stringify(draft.proposedOpeningSnapshot),
      );
    },

    getImportDraft(id) {
      const row = selectDraft.get(id) as ImportDraftRow | undefined;
      return row ? decodeDraft(row) : undefined;
    },

    updateImportDraft(id, review) {
      const result = updateDraft.run(
        review.confidence,
        JSON.stringify(review.warnings),
        JSON.stringify(review.proposedOpeningSnapshot),
        id,
      );

      if (result.changes !== 1) {
        throw new Error(`Import Draft ${id} is missing or already confirmed`);
      }
    },

    confirmImportDraft(id, confirmedAt) {
      database.exec("BEGIN IMMEDIATE");

      try {
        const row = selectDraft.get(id) as ImportDraftRow | undefined;

        if (!row) {
          throw new Error(`Import Draft ${id} does not exist`);
        }

        if (row.status === "draft" && row.source_kind !== "demo") {
          const snapshot = JSON.parse(
            row.proposed_snapshot_json,
          ) as OpeningSnapshotInput;
          insertSnapshot.run(
            snapshot.id,
            snapshot.sourceAccountId,
            snapshot.asOf,
            JSON.stringify(snapshot),
            id,
          );
        }
        markDraftConfirmed.run(confirmedAt, id);

        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    getPortfolioState() {
      const openingSnapshots = this.getOpeningSnapshots();
      const events = (selectEvents.all() as unknown as FactRow[]).map(
        (row) => JSON.parse(row.payload_json) as PortfolioEventInput,
      );
      return buildPortfolioState({ openingSnapshots, events });
    },

    getOpeningSnapshots() {
      return (selectSnapshots.all() as unknown as FactRow[]).map(
        (row) => JSON.parse(row.payload_json) as OpeningSnapshotInput,
      );
    },

    getConfirmedSnapshots() {
      const rows = selectConfirmedSnapshots.all() as unknown as Array<{
        payload_json: string;
        confirmed_at: string;
      }>;
      return rows.map((row) => ({
        snapshot: JSON.parse(row.payload_json) as OpeningSnapshotInput,
        confirmedAt: row.confirmed_at,
      }));
    },

    saveMarketPriceObservations(observations) {
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const observation of observations) {
          upsertMarketPrice.run(
            observation.sourceAccountId,
            observation.instrumentId,
            observation.instrumentCode,
            observation.price,
            observation.currency,
            observation.asOf,
            observation.recordedAt,
            observation.source,
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    getMarketPriceObservations() {
      const rows = selectMarketPrices.all() as unknown as Array<{
        source_account_id: string;
        instrument_id: string;
        instrument_code: string;
        price: string;
        currency: string;
        as_of: string;
        recorded_at: string;
        source: string;
      }>;
      return rows.map((row) => ({
        sourceAccountId: row.source_account_id,
        instrumentId: row.instrument_id,
        instrumentCode: row.instrument_code,
        price: row.price,
        currency: row.currency,
        asOf: row.as_of,
        recordedAt: row.recorded_at,
        source: row.source,
      }));
    },

    saveMarketRefreshRecord(record) {
      insertMarketRefresh.run(
        record.provider,
        record.completedAt,
        record.updated,
        record.unchanged,
        record.failed,
        JSON.stringify(record.failures),
      );
    },

    getLatestMarketRefreshRecord() {
      const row = selectLatestMarketRefresh.get() as {
        provider: string;
        completed_at: string;
        updated_count: number;
        unchanged_count: number;
        failed_count: number;
        failures_json: string;
      } | undefined;
      return row
        ? {
            provider: row.provider,
            completedAt: row.completed_at,
            updated: row.updated_count,
            unchanged: row.unchanged_count,
            failed: row.failed_count,
            failures: JSON.parse(row.failures_json) as MarketRefreshRecord["failures"],
          }
        : undefined;
    },

    getSourceAccountLabels() {
      const rows = selectAccountLabels.all() as unknown as Array<{
        source_account_id: string;
        custom_label: string;
      }>;
      return Object.fromEntries(
        rows.map((row) => [row.source_account_id, row.custom_label]),
      );
    },

    renameSourceAccount(id, label) {
      if (!findSourceAccount(id)) {
        throw new Error(`Unknown Source Account ${id}`);
      }
      const normalized = label.trim();
      if (!normalized) {
        throw new Error("Source Account label cannot be empty");
      }
      upsertAccountLabel.run(id, normalized);
    },

    close() {
      database.close();
    },
  };
}
