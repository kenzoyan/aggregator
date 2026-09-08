import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

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
  return createPortfolioOverviewReadModel({
    snapshots: facts.openingSnapshots,
    events: facts.events,
    marketPrices: marketData.observations,
    fxObservations: marketData.fxObservations,
    marketRefreshHistory: marketData.marketRefreshHistory,
    accountLabels: database.readSourceAccountLabels(),
    asOf,
  });
}
