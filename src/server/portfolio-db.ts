import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import {
  createPortfolioDatabase,
  type PortfolioDatabase,
} from "@/infrastructure/sqlite/portfolio-repository";

const globalDatabase = globalThis as typeof globalThis & {
  portfolioDatabase?: PortfolioDatabase;
};

type CachedPortfolioDatabase = Pick<PortfolioDatabase, "close"> &
  Partial<Pick<
    PortfolioDatabase,
    | "readLatestMarketIntelligenceBrief"
    | "saveMarketIntelligenceBrief"
    | "deleteSourceAccount"
    | "saveImportDraftReview"
  >>;

export function ensureCurrentPortfolioDatabase<
  T extends CachedPortfolioDatabase,
  R extends CachedPortfolioDatabase,
>(
  database: T | undefined,
  create: () => R,
): T | R {
  if (
    database &&
    typeof database.readLatestMarketIntelligenceBrief === "function" &&
    typeof database.saveMarketIntelligenceBrief === "function" &&
    typeof database.deleteSourceAccount === "function" &&
    typeof database.saveImportDraftReview === "function"
  ) {
    return database;
  }
  database?.close();
  return create();
}

export function getPortfolioDatabase(): PortfolioDatabase {
  const dataDirectory = join(process.cwd(), "data");
  const configuredName = process.env.PORTFOLIO_DB_FILENAME;
  const databaseName = configuredName
    ? basename(configuredName)
    : "invest-assets-monitor.sqlite";
  const filename = join(dataDirectory, databaseName);
  globalDatabase.portfolioDatabase = ensureCurrentPortfolioDatabase(
    globalDatabase.portfolioDatabase,
    () => {
      mkdirSync(dataDirectory, { recursive: true });
      return createPortfolioDatabase(filename);
    },
  );

  return globalDatabase.portfolioDatabase;
}
