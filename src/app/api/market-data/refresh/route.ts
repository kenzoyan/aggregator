import { NextResponse } from "next/server";

import { refreshFundNavs } from "@/application/market-refresh";
import type { FundNavProvider, MarketPriceObservation } from "@/domain/market-data";
import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketRefreshDatabase = Pick<
  PortfolioDatabase,
  "readPortfolioFacts" | "readMarketData" | "recordMarketData"
>;

export function createMarketRefreshHandler(input: {
  database: MarketRefreshDatabase;
  provider: FundNavProvider;
  now?: () => string;
}) {
  return async function handleMarketRefresh() {
    try {
      const facts = input.database.readPortfolioFacts();
      const marketData = input.database.readMarketData();
      const observations: MarketPriceObservation[] = [];
      const result = await refreshFundNavs({
        state: facts.state,
        existingObservations: marketData.observations,
        monitoringStartedAtByPosition: Object.fromEntries(
          facts.openingSnapshots
            .flatMap((snapshot) => snapshot.positions.map((position) => ({
              key: `${snapshot.sourceAccountId}:${position.instrumentId}`,
              asOf: snapshot.asOf,
            })))
            .sort((left, right) => right.asOf.localeCompare(left.asOf))
            .map((item) => [item.key, item.asOf]),
        ),
        provider: input.provider,
        record: (recorded) => {
          observations.push(...recorded);
        },
        now: input.now?.() ?? new Date().toISOString(),
      });
      input.database.recordMarketData({
        observations,
        refresh: {
          provider: input.provider.id,
          completedAt: result.refreshedAt,
          updated: result.updated,
          unchanged: result.unchanged,
          failed: result.failed.length,
          failures: result.failed,
        },
      });
      return NextResponse.json(result);
    } catch (error) {
      console.error("Market data refresh failed", error);
      return NextResponse.json(
        { error: "Market data refresh could not be completed" },
        { status: 500 },
      );
    }
  };
}

export async function POST() {
  return createMarketRefreshHandler({
    database: getPortfolioDatabase(),
    provider: new EastmoneyFundNavClient(),
  })();
}
