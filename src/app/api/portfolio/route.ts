import { NextResponse } from "next/server";

import {
  createEurCnyOverview,
  createFxRateObservations,
  eurPerUnitAt,
} from "@/application/fx-history";
import { createHoldingHistoryReadModel } from "@/application/holding-history";
import { createPortfolioInsightsReadModel } from "@/application/portfolio-insights";
import {
  createDashboardReadModel,
  createPortfolioHistoryReadModel,
} from "@/application/portfolio-dashboard";
import { combinePortfolioPeriodHistory } from "@/application/portfolio-periods";
import { createSourceAccountStatusReadModel } from "@/application/source-account-status";
import { sourceAccounts } from "@/domain/source-accounts";
import { EcbFxClient, type EcbRates } from "@/infrastructure/ecb/ecb-fx-client";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const marketPrices = marketData.observations;
    const latestMarketRefresh = marketData.latestMarketRefresh;
    const accountLabels = database.readSourceAccountLabels();
    const snapshotTimes = Object.fromEntries(
      snapshots.map((snapshot) => [snapshot.sourceAccountId, snapshot.asOf]),
    );

    let fxObservations = marketData.fxObservations;
    try {
      const rates = await input.fetchLatestRates();
      const recorded = createFxRateObservations({ rates, recordedAt: now });
      database.recordMarketData({ observations: [], fxObservations: recorded });
      fxObservations = [...fxObservations, ...recorded];
    } catch (error) {
      (input.logError ?? console.error)("ECB FX refresh failed", error);
    }
    const eurPerUnit = eurPerUnitAt(fxObservations, now);
    const fxAsOf = fxObservations
      .map((observation) => observation.asOf)
      .sort()
      .at(-1) ?? now;

    const portfolio = createDashboardReadModel({
      state,
      snapshots,
      asOf: now,
      snapshotTimes,
      marketPrices,
      latestMarketRefresh,
      eurPerUnit,
      fxAsOf,
      accountLabels,
    });
    const portfolioHistory = createPortfolioHistoryReadModel({
      snapshots,
      events: facts.events,
      marketPrices,
      fxObservations,
      asOf: now,
      eurPerUnit,
      fxAsOf,
    });
    const holdingHistory = createHoldingHistoryReadModel({
      state,
      snapshots,
      events: facts.events,
      marketPrices,
      fxObservations,
      asOf: now,
    });
    const fxOverview = createEurCnyOverview(fxObservations, now);
    const history = combinePortfolioPeriodHistory({
      portfolioHistory,
      holdingHistory,
      currentTotalValueEur: portfolio.totalValueEur,
    });
    const holdings = portfolio.holdings.map((holding) => ({
      ...holding,
      ...(holdingHistory[holding.id]
        ? { history: holdingHistory[holding.id] }
        : {}),
    }));
    const portfolioWithHistory = {
      ...portfolio,
      holdings,
      history,
      ...(fxOverview ? { fxOverview } : {}),
    };
    const insights = createPortfolioInsightsReadModel({
      portfolio: portfolioWithHistory,
      asOf: now,
    });

    return NextResponse.json({
      hasPortfolioData: state.positions.length > 0 || state.cashBalances.length > 0,
      portfolio: {
        ...portfolioWithHistory,
        insights,
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
