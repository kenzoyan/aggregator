import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import {
  createPortfolioDatabase,
  type PortfolioDatabase,
} from "@/infrastructure/sqlite/portfolio-repository";

const globalDatabase = globalThis as typeof globalThis & {
  portfolioDatabase?: PortfolioDatabase;
};

export function getPortfolioDatabase(): PortfolioDatabase {
  if (!globalDatabase.portfolioDatabase) {
    const dataDirectory = join(process.cwd(), "data");
    const configuredName = process.env.PORTFOLIO_DB_FILENAME;
    const databaseName = configuredName
      ? basename(configuredName)
      : "invest-assets-monitor.sqlite";
    const filename = join(dataDirectory, databaseName);
    mkdirSync(dataDirectory, { recursive: true });
    globalDatabase.portfolioDatabase = createPortfolioDatabase(filename);
  }

  return globalDatabase.portfolioDatabase;
}
