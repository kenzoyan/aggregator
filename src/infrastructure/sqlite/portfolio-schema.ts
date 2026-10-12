import { DatabaseSync } from "node:sqlite";

import { legacyPartialSnapshotWarningMarker } from "@/domain/imports";

export const portfolioSchemaVersion = 15;

export class LegacyPortfolioDatabaseError extends Error {
  constructor() {
    super(
      "This database uses the disposable pre-v2 schema. Move or remove the test database, then re-import your CSV and Trading 212 data.",
    );
    this.name = "LegacyPortfolioDatabaseError";
  }
}

const portfolioNarrativesSchema = `
  CREATE TABLE portfolio_narratives (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    language TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    portfolio_as_of TEXT NOT NULL,
    facts_fingerprint TEXT NOT NULL,
    content_json TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    disclaimer TEXT NOT NULL
  );

  CREATE INDEX portfolio_narratives_latest
    ON portfolio_narratives(generated_at DESC);
`;

const portfolioAnalystConversationsSchema = `
  CREATE TABLE IF NOT EXISTS portfolio_analyst_conversations (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    language TEXT NOT NULL,
    include_holding_names INTEGER NOT NULL CHECK (include_holding_names IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    turns_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS portfolio_analyst_conversations_latest
    ON portfolio_analyst_conversations(updated_at DESC);
`;

const portfolioAnalystMemorySchema = `
  CREATE TABLE IF NOT EXISTS portfolio_analyst_memory (
    kind TEXT PRIMARY KEY CHECK (kind = 'performance-answer-order'),
    value TEXT NOT NULL CHECK (value IN ('eur-first', 'percent-first')),
    source TEXT NOT NULL CHECK (source IN ('chat', 'settings')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const portfolioAnalystMemoriesSchema = `
  CREATE TABLE IF NOT EXISTS portfolio_analyst_memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('chat', 'settings')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const marketIntelligenceSchema = `
  CREATE TABLE IF NOT EXISTS market_intelligence_briefs (
    id TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    content_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS market_intelligence_briefs_latest
    ON market_intelligence_briefs(generated_at DESC);
`;

const sourceAccountsSchema = `
  CREATE TABLE IF NOT EXISTS source_accounts (
    id TEXT PRIMARY KEY,
    account_type TEXT NOT NULL,
    normalized_account_type TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL CHECK (
      provider IN ('alipay', 'wechat', 'danske', 'trading212', 'generic')
    ),
    label TEXT NOT NULL,
    dashboard_label TEXT NOT NULL,
    update_method TEXT NOT NULL CHECK (
      update_method IN ('screenshot', 'trading-212')
    )
  );

  INSERT OR IGNORE INTO source_accounts (
    id, account_type, normalized_account_type, provider, label,
    dashboard_label, update_method
  ) VALUES
    ('alipay-main', 'Alipay', 'alipay', 'alipay', 'Alipay', 'Alipay', 'screenshot'),
    ('wechat-main', 'WeChat Wealth Management', 'wechatwealthmanagement', 'wechat', 'WeChat Wealth Management', 'WeChat', 'screenshot'),
    ('danske-main', 'Danske Bank', 'danskebank', 'danske', 'Danske Bank', 'Danske', 'screenshot'),
    ('trading212-main', 'Trading 212', 'trading212', 'trading212', 'Trading 212', 'Trading 212', 'trading-212');
`;

const priceSourceBindingsSchema = (withStatus: boolean) => `
  CREATE TABLE IF NOT EXISTS price_source_bindings (
    source_account_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    instrument_name TEXT NOT NULL,
    instrument_code TEXT NOT NULL,
    currency TEXT NOT NULL,
    share_class TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('eastmoney', 'financial-times', 'danske-invest', 'nordea-funds')),
    identity_url TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    ${withStatus ? `last_checked_at TEXT,
    last_outcome TEXT CHECK (last_outcome IN ('updated', 'unchanged', 'failed')),
    latest_price_as_of TEXT,
    last_failure_category TEXT,` : ""}
    PRIMARY KEY (source_account_id, instrument_id)
  );
`;

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
          payload_scope TEXT NOT NULL DEFAULT 'complete'
            CHECK (payload_scope IN ('complete', 'legacy-partial')),
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
          mode TEXT NOT NULL CHECK (mode IN ('manual', 'automatic', 'unknown')),
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

        ${sourceAccountsSchema}
        ${priceSourceBindingsSchema(true)}

        ${portfolioNarrativesSchema}
        ${portfolioAnalystConversationsSchema}
        ${portfolioAnalystMemoriesSchema}
        ${marketIntelligenceSchema}
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
  if (row?.version === 2 || row?.version === 3) {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (row.version === 2) database.exec(portfolioNarrativesSchema);
      database.exec(`
        ALTER TABLE opening_snapshots ADD COLUMN payload_scope TEXT NOT NULL
          DEFAULT 'complete'
          CHECK (payload_scope IN ('complete', 'legacy-partial'));

        UPDATE opening_snapshots
        SET payload_scope = 'legacy-partial'
        WHERE EXISTS (
          SELECT 1
          FROM confirmed_imports
          JOIN import_drafts ON import_drafts.id = confirmed_imports.draft_id
          WHERE confirmed_imports.id = opening_snapshots.confirmed_import_id
            AND confirmed_imports.source_kind IN ('csv', 'manual', 'screenshot')
            AND instr(
              import_drafts.warnings_json,
              '${legacyPartialSnapshotWarningMarker}'
            ) = 0
        )
        AND EXISTS (
          SELECT 1
          FROM opening_snapshots AS previous_snapshot
          JOIN confirmed_imports AS previous_import
            ON previous_import.id = previous_snapshot.confirmed_import_id
          WHERE previous_snapshot.source_account_id = opening_snapshots.source_account_id
            AND (
              previous_snapshot.as_of < opening_snapshots.as_of
              OR (
                previous_snapshot.as_of = opening_snapshots.as_of
                AND previous_import.confirmed_at < (
                  SELECT current_import.confirmed_at
                  FROM confirmed_imports AS current_import
                  WHERE current_import.id = opening_snapshots.confirmed_import_id
                )
              )
              OR (
                previous_snapshot.as_of = opening_snapshots.as_of
                AND previous_import.confirmed_at = (
                  SELECT current_import.confirmed_at
                  FROM confirmed_imports AS current_import
                  WHERE current_import.id = opening_snapshots.confirmed_import_id
                )
                AND previous_snapshot.rowid < opening_snapshots.rowid
              )
            )
        );

        UPDATE schema_metadata SET version = 4;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const currentRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (currentRow?.version === 4) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ALTER TABLE market_refresh_runs ADD COLUMN mode TEXT NOT NULL
          DEFAULT 'unknown'
          CHECK (mode IN ('manual', 'automatic', 'unknown'));
        UPDATE market_refresh_runs
        SET failures_json = CASE
          WHEN failed_count > 0 THEN
            '[{"instrumentCode":"Earlier run","message":"Failure details from this earlier run were removed for privacy"}]'
          ELSE '[]'
        END;
        UPDATE schema_metadata SET version = 5;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const analystConversationRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (analystConversationRow?.version === 5) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ${portfolioAnalystConversationsSchema}
        UPDATE schema_metadata SET version = 6;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const marketIntelligenceRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (marketIntelligenceRow?.version === 6) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ${marketIntelligenceSchema}
        UPDATE schema_metadata SET version = 7;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const sourceAccountsRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (sourceAccountsRow?.version === 7) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ${sourceAccountsSchema}
        UPDATE schema_metadata SET version = 8;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const priceSourceBindingsRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (priceSourceBindingsRow?.version === 8) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ${priceSourceBindingsSchema(false)}
        UPDATE schema_metadata SET version = 9;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const priceSourceStatusRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (priceSourceStatusRow?.version === 9) {
    const existingColumns = new Set((database.prepare(
      "PRAGMA table_info(price_source_bindings)",
    ).all() as Array<{ name: string }>).map((column) => column.name));
    const statusColumns = [
      ["last_checked_at", "TEXT"],
      ["last_outcome", "TEXT CHECK (last_outcome IN ('updated', 'unchanged', 'failed'))"],
      ["latest_price_as_of", "TEXT"],
      ["last_failure_category", "TEXT"],
    ] as const;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const [name, definition] of statusColumns) {
        if (!existingColumns.has(name)) {
          database.exec(`ALTER TABLE price_source_bindings ADD COLUMN ${name} ${definition}`);
        }
      }
      database.exec("UPDATE schema_metadata SET version = 10");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const memoryRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (memoryRow?.version === 10) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`${portfolioAnalystMemorySchema} UPDATE schema_metadata SET version = 11;`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const memoryListRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (memoryListRow?.version === 11) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ${portfolioAnalystMemoriesSchema}
        INSERT INTO portfolio_analyst_memories (id, content, source, created_at, updated_at)
        SELECT 'migrated-answer-order',
          CASE value WHEN 'eur-first' THEN 'When both are available, show the EUR change before the percentage.'
            ELSE 'When both are available, show the percentage before the EUR change.' END,
          source, created_at, updated_at
        FROM portfolio_analyst_memory;
        DROP TABLE portfolio_analyst_memory;
        UPDATE schema_metadata SET version = 12;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const providerRow = database.prepare("SELECT version FROM schema_metadata LIMIT 1").get() as { version: number } | undefined;
  if (providerRow?.version === 12) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ALTER TABLE price_source_bindings RENAME TO price_source_bindings_v12;
        ${priceSourceBindingsSchema(true)}
        INSERT INTO price_source_bindings SELECT * FROM price_source_bindings_v12;
        DROP TABLE price_source_bindings_v12;
        UPDATE schema_metadata SET version = 13;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const danskeProviderRow = database.prepare("SELECT version FROM schema_metadata LIMIT 1").get() as { version: number } | undefined;
  if (danskeProviderRow?.version === 13) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ALTER TABLE price_source_bindings RENAME TO price_source_bindings_v13;
        ${priceSourceBindingsSchema(true)}
        INSERT INTO price_source_bindings SELECT * FROM price_source_bindings_v13;
        DROP TABLE price_source_bindings_v13;
        UPDATE schema_metadata SET version = 14;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const nordeaProviderRow = database.prepare("SELECT version FROM schema_metadata LIMIT 1").get() as { version: number } | undefined;
  if (nordeaProviderRow?.version === 14) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        ALTER TABLE price_source_bindings RENAME TO price_source_bindings_v14;
        ${priceSourceBindingsSchema(true)}
        INSERT INTO price_source_bindings SELECT * FROM price_source_bindings_v14;
        DROP TABLE price_source_bindings_v14;
        UPDATE schema_metadata SET version = 15;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const finalRow = database.prepare(
    "SELECT version FROM schema_metadata LIMIT 1",
  ).get() as { version: number } | undefined;
  if (finalRow?.version !== portfolioSchemaVersion) {
    throw new LegacyPortfolioDatabaseError();
  }
}
