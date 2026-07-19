import { DatabaseSync } from "node:sqlite";

import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type {
  OpeningSnapshotInput,
  PortfolioEventInput,
  PortfolioState,
} from "@/domain/portfolio/types";

export interface ImportDraftInput {
  id: string;
  sourceAccountId: string;
  sourceKind: "screenshot" | "trading-212" | "manual";
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
  `);

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
    SELECT payload_json
    FROM opening_snapshots
    ORDER BY as_of, id
  `);
  const selectEvents = database.prepare(`
    SELECT payload_json
    FROM portfolio_events
    ORDER BY as_of, id
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

        if (row.status === "draft") {
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
          markDraftConfirmed.run(confirmedAt, id);
        }

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

    close() {
      database.close();
    },
  };
}
