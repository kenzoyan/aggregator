import type { DatabaseSync } from "node:sqlite";

import { marketIntelligenceBriefSchema } from "@/application/market-intelligence";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";

type MarketIntelligenceBriefRepository = Pick<
  PortfolioDatabase,
  "saveMarketIntelligenceBrief" | "readLatestMarketIntelligenceBrief"
>;

export function createMarketIntelligenceBriefRepository(
  database: DatabaseSync,
): MarketIntelligenceBriefRepository {
  const insertBrief = database.prepare(`
    INSERT INTO market_intelligence_briefs (id, generated_at, content_json)
    VALUES (?, ?, ?)
  `);
  const selectLatestBrief = database.prepare(`
    SELECT content_json
    FROM market_intelligence_briefs
    ORDER BY generated_at DESC, rowid DESC
    LIMIT 1
  `);
  const deleteOtherBriefs = database.prepare(
    "DELETE FROM market_intelligence_briefs WHERE id <> ?",
  );

  return {
    saveMarketIntelligenceBrief(brief) {
      database.exec("BEGIN IMMEDIATE");
      try {
        insertBrief.run(
          brief.id,
          brief.generatedAt,
          JSON.stringify(brief),
        );
        deleteOtherBriefs.run(brief.id);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    readLatestMarketIntelligenceBrief() {
      const row = selectLatestBrief.get() as
        | { content_json: string }
        | undefined;
      return row
        ? marketIntelligenceBriefSchema.parse(JSON.parse(row.content_json))
        : undefined;
    },
  };
}
