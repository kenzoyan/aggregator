import { DatabaseSync } from "node:sqlite";

export const portfolioSchemaVersion = 2;

export class LegacyPortfolioDatabaseError extends Error {
  constructor() {
    super(
      "This database uses the disposable pre-v2 schema. Move or remove the test database, then re-import your CSV and Trading 212 data.",
    );
    this.name = "LegacyPortfolioDatabaseError";
  }
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table),
  );
}

export function initializePortfolioSchema(database: DatabaseSync) {
  if (!tableExists(database, "schema_metadata")) {
    const legacyTables = [
      "import_drafts",
      "opening_snapshots",
      "portfolio_events",
      "market_price_observations",
      "source_account_labels",
    ].filter((table) => tableExists(database, table));
    if (legacyTables.length > 0) throw new LegacyPortfolioDatabaseError();

    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE schema_metadata (
          version INTEGER NOT NULL
        );
        INSERT INTO schema_metadata (version) VALUES (${portfolioSchemaVersion});

        CREATE TABLE import_drafts (
          id TEXT PRIMARY KEY,
          source_account_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          created_at TEXT NOT NULL,
          confidence TEXT NOT NULL,
          warnings_json TEXT NOT NULL,
          portfolio_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'discarded')),
          confirmed_at TEXT
        );

        CREATE TABLE confirmed_imports (
          id TEXT PRIMARY KEY,
          draft_id TEXT NOT NULL UNIQUE,
          source_account_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          confirmed_at TEXT NOT NULL,
          FOREIGN KEY (draft_id) REFERENCES import_drafts(id)
        );

        CREATE TABLE opening_snapshots (
          id TEXT PRIMARY KEY,
          source_account_id TEXT NOT NULL,
          as_of TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          confirmed_import_id TEXT NOT NULL UNIQUE,
          FOREIGN KEY (confirmed_import_id) REFERENCES confirmed_imports(id)
        );

        CREATE TABLE portfolio_events (
          id TEXT PRIMARY KEY,
          source_account_id TEXT NOT NULL,
          as_of TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          confirmed_import_id TEXT,
          idempotency_key TEXT UNIQUE,
          FOREIGN KEY (confirmed_import_id) REFERENCES confirmed_imports(id)
        );

        CREATE TABLE market_price_observations (
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

        CREATE TABLE fx_observations (
          currency TEXT NOT NULL,
          eur_per_unit TEXT NOT NULL,
          as_of TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          source TEXT NOT NULL,
          PRIMARY KEY (currency, as_of, source)
        );

        CREATE TABLE market_refresh_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          completed_at TEXT NOT NULL,
          updated_count INTEGER NOT NULL,
          unchanged_count INTEGER NOT NULL,
          failed_count INTEGER NOT NULL,
          failures_json TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE source_sync_state (
          source_account_id TEXT PRIMARY KEY,
          connector TEXT NOT NULL,
          cursor TEXT,
          last_attempt_at TEXT,
          last_success_at TEXT,
          last_error TEXT
        );

        CREATE TABLE source_account_labels (
          source_account_id TEXT PRIMARY KEY,
          custom_label TEXT NOT NULL
        );
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return;
  }

  database.exec("PRAGMA foreign_keys = ON");
  const row = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (row?.version !== portfolioSchemaVersion) {
    throw new LegacyPortfolioDatabaseError();
  }
}
