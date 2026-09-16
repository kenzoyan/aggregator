import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { effectiveSourceAccountLabels } from "@/domain/source-accounts";
import { createStoredPortfolioOverviewReadModel } from "@/server/stored-portfolio-overview";

type CurrentPortfolioDatabase = Pick<
  PortfolioDatabase,
  "readPortfolioFacts" | "readMarketData" | "readSourceAccountLabels" | "readSourceAccounts"
>;

export function readCurrentPortfolioOverview(
  database: CurrentPortfolioDatabase,
  asOf: string,
) {
  const facts = database.readPortfolioFacts();
  if (facts.state.positions.length === 0 && facts.state.cashBalances.length === 0) {
    return undefined;
  }
  return createOverview(database, facts, asOf);
}

export function readPortfolioOverviewIncludingEmpty(
  database: CurrentPortfolioDatabase,
  asOf: string,
) {
  return createOverview(database, database.readPortfolioFacts(), asOf);
}

function createOverview(
  database: CurrentPortfolioDatabase,
  facts: ReturnType<CurrentPortfolioDatabase["readPortfolioFacts"]>,
  asOf: string,
) {
  const marketData = database.readMarketData();
  const accounts = database.readSourceAccounts();
  return createStoredPortfolioOverviewReadModel({
    facts,
    marketData,
    accountLabels: effectiveSourceAccountLabels(
      accounts,
      database.readSourceAccountLabels(),
    ),
    asOf,
  });
}
