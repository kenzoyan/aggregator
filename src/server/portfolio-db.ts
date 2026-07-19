import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/infrastructure/sqlite/portfolio-repository";

const globalDatabase = globalThis as typeof globalThis & {
  portfolioRepository?: PortfolioRepository;
};

export function getPortfolioRepository(): PortfolioRepository {
  if (!globalDatabase.portfolioRepository) {
    const dataDirectory = join(process.cwd(), "data");
    const configuredName = process.env.PORTFOLIO_DB_FILENAME;
    const databaseName = configuredName
      ? basename(configuredName)
      : "invest-assets-monitor.sqlite";
    const filename = join(dataDirectory, databaseName);
    mkdirSync(dataDirectory, { recursive: true });
    globalDatabase.portfolioRepository = createPortfolioRepository(filename);
  }

  return globalDatabase.portfolioRepository;
}
