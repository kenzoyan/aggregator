import { DatabaseSync } from "node:sqlite";

import { createImportPortfolioRepository } from "@/infrastructure/sqlite/import-portfolio-repository";
import { createMarketDataRepository } from "@/infrastructure/sqlite/market-data-repository";
import { createMarketIntelligenceBriefRepository } from "@/infrastructure/sqlite/market-intelligence-brief-repository";
import { createPortfolioAnalystConversationRepository } from "@/infrastructure/sqlite/portfolio-analyst-conversation-repository";
import { createPortfolioNarrativeRepository } from "@/infrastructure/sqlite/portfolio-narrative-repository";
import { createPriceSourceBindingRepository } from "@/infrastructure/sqlite/price-source-binding-repository";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";
import { initializePortfolioSchema } from "@/infrastructure/sqlite/portfolio-schema";
import { createSourceAccountLabelRepository } from "@/infrastructure/sqlite/source-account-label-repository";

export * from "@/infrastructure/sqlite/portfolio-repository-contract";
export {
  LegacyPortfolioDatabaseError,
  portfolioSchemaVersion,
} from "@/infrastructure/sqlite/portfolio-schema";

export function createPortfolioDatabase(filename: string): PortfolioDatabase {
  const database = new DatabaseSync(filename);
  try {
    initializePortfolioSchema(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const portfolioAnalystConversations =
    createPortfolioAnalystConversationRepository(database);
  const marketIntelligenceBriefs =
    createMarketIntelligenceBriefRepository(database);
  const portfolioNarratives = createPortfolioNarrativeRepository(database);
  const sourceAccountLabels = createSourceAccountLabelRepository(database);
  const marketData = createMarketDataRepository(database);
  const priceSourceBindings = createPriceSourceBindingRepository(database);
  const importPortfolio = createImportPortfolioRepository(database);

  return {
    ...importPortfolio,
    ...marketData,
    ...priceSourceBindings,
    ...sourceAccountLabels,
    ...portfolioNarratives,
    ...marketIntelligenceBriefs,
    ...portfolioAnalystConversations,

    close() {
      database.close();
    },
  };
}
