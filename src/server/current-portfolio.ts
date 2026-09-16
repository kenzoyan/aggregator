import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createStoredPortfolioOverviewReadModel } from "@/server/stored-portfolio-overview";

type CurrentPortfolioDatabase = Pick<
  PortfolioDatabase,
  "readPortfolioFacts" | "readMarketData" | "readSourceAccountLabels"
>;

export function readCurrentPortfolioOverview(
  database: CurrentPortfolioDatabase,
  asOf: string,
) {
  const facts = database.readPortfolioFacts();
  if (facts.state.positions.length === 0 && facts.state.cashBalances.length === 0) {
    return undefined;
  }
  const marketData = database.readMarketData();
  return createStoredPortfolioOverviewReadModel({
    facts,
    marketData,
    accountLabels: database.readSourceAccountLabels(),
    asOf,
  });
}
