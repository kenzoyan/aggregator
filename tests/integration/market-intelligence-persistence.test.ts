import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { MarketIntelligenceBrief } from "@/application/market-intelligence";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { initializePortfolioSchema, portfolioSchemaVersion } from "@/infrastructure/sqlite/portfolio-schema";

describe("market intelligence persistence", () => {
  it("round-trips the latest external market brief", () => {
    const database = createPortfolioDatabase(join(mkdtempSync(join(tmpdir(), "market-intelligence-")), "portfolio.sqlite"));
    const brief: MarketIntelligenceBrief = {
      version: "market-intelligence.v1",
      id: "brief-1",
      provider: "openai",
      model: "gpt-synthetic",
      language: "en",
      generatedAt: "2026-09-13T12:00:00.000Z",
      windowStart: "2026-09-13",
      windowEnd: "2026-10-12",
      events: [],
      disclaimer: "External market information · Not investment advice",
    };
    database.saveMarketIntelligenceBrief(brief);
    expect(database.readLatestMarketIntelligenceBrief()).toEqual(brief);
    database.close();
  });

  it("adds the brief store when upgrading a version 6 database", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE schema_metadata (version INTEGER NOT NULL); INSERT INTO schema_metadata VALUES (6)");
    initializePortfolioSchema(database);
    expect(database.prepare("SELECT version FROM schema_metadata").get()).toEqual({ version: portfolioSchemaVersion });
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'market_intelligence_briefs'",
    ).get()).toEqual({ name: "market_intelligence_briefs" });
    database.close();
  });
});
