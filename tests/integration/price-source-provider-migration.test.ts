import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { initializePortfolioSchema, portfolioSchemaVersion } from "@/infrastructure/sqlite/portfolio-schema";

describe("price source provider migration", () => {
  it("preserves the existing Eastmoney binding and its refresh status when upgrading v12", () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializePortfolioSchema(db);
      db.exec(`DROP TABLE price_source_bindings;
        CREATE TABLE price_source_bindings (
          source_account_id TEXT NOT NULL, instrument_id TEXT NOT NULL, instrument_name TEXT NOT NULL,
          instrument_code TEXT NOT NULL, currency TEXT NOT NULL, share_class TEXT NOT NULL,
          provider TEXT NOT NULL CHECK (provider = 'eastmoney'), identity_url TEXT NOT NULL,
          confirmed_at TEXT NOT NULL, last_checked_at TEXT,
          last_outcome TEXT CHECK (last_outcome IN ('updated', 'unchanged', 'failed')),
          latest_price_as_of TEXT, last_failure_category TEXT,
          PRIMARY KEY (source_account_id, instrument_id));
        INSERT INTO price_source_bindings VALUES ('synthetic','fund','Example','012414','CNY','C','eastmoney',
          'https://example.test','2026-10-01T00:00:00Z','2026-10-09T00:00:00Z','updated','2026-10-08',NULL);
        UPDATE schema_metadata SET version = 12;`);
      const before = db.prepare("SELECT * FROM price_source_bindings").all();
      initializePortfolioSchema(db);
      expect(db.prepare("SELECT * FROM price_source_bindings").all()).toEqual(before);
      expect(db.prepare("SELECT version FROM schema_metadata").get()).toEqual({ version: portfolioSchemaVersion });
      db.exec("UPDATE price_source_bindings SET provider = 'financial-times'");
      expect(() => db.exec("UPDATE price_source_bindings SET provider = 'unknown'")).toThrow();
      initializePortfolioSchema(db);
    } finally { db.close(); }
  });
  it("preserves v13 bindings and statuses while permitting the new Danske provider", () => {
    const db = new DatabaseSync(":memory:");
    try {
      initializePortfolioSchema(db);
      db.exec(`UPDATE schema_metadata SET version = 13;
        INSERT INTO price_source_bindings VALUES ('synthetic','fund','Example','FI4000439773','EUR','A','financial-times',
          'https://example.test','2026-10-01','2026-10-09','updated','2026-10-08',NULL);`);
      const before = db.prepare("SELECT * FROM price_source_bindings").all();
      initializePortfolioSchema(db);
      expect(db.prepare("SELECT * FROM price_source_bindings").all()).toEqual(before);
      db.exec("UPDATE price_source_bindings SET provider = 'danske-invest'");
      expect(() => db.exec("UPDATE price_source_bindings SET provider = 'unknown'")).toThrow();
      initializePortfolioSchema(db);
    } finally { db.close(); }
  });

});
