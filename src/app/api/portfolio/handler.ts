import { NextResponse } from "next/server";

import {
  createFxRateObservations,
} from "@/application/fx-history";
import { createSourceAccountStatusReadModel } from "@/application/source-account-status";
import type { FxRateObservation } from "@/domain/market-data";
import { sourceAccounts } from "@/domain/source-accounts";
import { EcbFxClient, type EcbRates } from "@/infrastructure/ecb/ecb-fx-client";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { createStoredPortfolioOverviewReadModel } from "@/server/stored-portfolio-overview";

let cachedRates: { expiresAt: number; value: EcbRates } | undefined;

async function latestRates(): Promise<EcbRates> {
  if (cachedRates && cachedRates.expiresAt > Date.now()) return cachedRates.value;
  const value = await new EcbFxClient().fetchLatestRates();
  cachedRates = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value };
  return value;
}

type PortfolioQueryDatabase = Pick<
  PortfolioDatabase,
  | "readPortfolioFacts"
  | "readMarketData"
  | "readSourceAccountLabels"
  | "recordMarketData"
>;

export function createPortfolioHandler(input: {
  database: PortfolioQueryDatabase;
  fetchLatestRates: () => Promise<EcbRates>;
  now?: () => string;
  logError?: (message: string, error: unknown) => void;
}) {
  return async function handlePortfolio() {
    const database = input.database;
    const now = input.now?.() ?? new Date().toISOString();
    const facts = database.readPortfolioFacts();
    const marketData = database.readMarketData();
    const state = facts.state;
    const snapshots = facts.openingSnapshots;
    const accountLabels = database.readSourceAccountLabels();
    let additionalFxObservations: FxRateObservation[] = [];
    try {
      const rates = await input.fetchLatestRates();
      const recorded = createFxRateObservations({ rates, recordedAt: now });
      database.recordMarketData({ observations: [], fxObservations: recorded });
      additionalFxObservations = recorded;
    } catch (error) {
      (input.logError ?? console.error)("ECB FX refresh failed", error);
    }
    const portfolio = createStoredPortfolioOverviewReadModel({
      facts,
      marketData,
      accountLabels,
      asOf: now,
      additionalFxObservations,
    });

    return NextResponse.json({
      hasPortfolioData: state.positions.length > 0 || state.cashBalances.length > 0,
      portfolio: {
        ...portfolio,
        accounts: createSourceAccountStatusReadModel({
          accounts: sourceAccounts,
          confirmedSnapshots: facts.confirmedSnapshots,
          snapshots,
          state,
          labels: accountLabels,
          now,
        }),
      },
    });
  };
}

export async function GET() {
  return createPortfolioHandler({
    database: getPortfolioDatabase(),
    fetchLatestRates: latestRates,
  })();
}
