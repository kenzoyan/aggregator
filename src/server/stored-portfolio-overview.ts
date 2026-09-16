import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import type { FxRateObservation } from "@/domain/market-data";
import type {
  MarketDataHistory,
  PortfolioFacts,
} from "@/infrastructure/sqlite/portfolio-repository";

export function createStoredPortfolioOverviewReadModel(input: {
  facts: PortfolioFacts;
  marketData: MarketDataHistory;
  accountLabels: Record<string, string>;
  asOf: string;
  additionalFxObservations?: readonly FxRateObservation[];
}) {
  return createPortfolioOverviewReadModel({
    snapshots: input.facts.openingSnapshots,
    events: input.facts.events,
    marketPrices: input.marketData.observations,
    fxObservations: [
      ...input.marketData.fxObservations,
      ...(input.additionalFxObservations ?? []),
    ],
    marketRefreshHistory: input.marketData.marketRefreshHistory,
    accountLabels: input.accountLabels,
    asOf: input.asOf,
  });
}
