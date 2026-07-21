import { NextResponse } from "next/server";

import { refreshFundNavs } from "@/application/market-refresh";
import type {
  FundNavProvider,
  MarketPriceObservation,
  MarketRefreshRecord,
} from "@/domain/market-data";
import type {
  OpeningSnapshotInput,
  PortfolioState,
} from "@/domain/portfolio/types";
import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";
import { getPortfolioRepository } from "@/server/portfolio-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MarketRefreshRepository {
  getPortfolioState(): PortfolioState;
  getOpeningSnapshots(): OpeningSnapshotInput[];
  getMarketPriceObservations(): MarketPriceObservation[];
  saveMarketPriceObservations(
    observations: readonly MarketPriceObservation[],
  ): void;
  saveMarketRefreshRecord(record: MarketRefreshRecord): void;
}

export function createMarketRefreshHandler(input: {
  repository: MarketRefreshRepository;
  provider: FundNavProvider;
  now?: () => string;
}) {
  return async function handleMarketRefresh() {
    try {
      const result = await refreshFundNavs({
        state: input.repository.getPortfolioState(),
        existingObservations: input.repository.getMarketPriceObservations(),
        monitoringStartedAtByPosition: Object.fromEntries(
          input.repository.getOpeningSnapshots()
            .flatMap((snapshot) => snapshot.positions.map((position) => ({
              key: `${snapshot.sourceAccountId}:${position.instrumentId}`,
              asOf: snapshot.asOf,
            })))
            .sort((left, right) => right.asOf.localeCompare(left.asOf))
            .map((item) => [item.key, item.asOf]),
        ),
        provider: input.provider,
        record: (observations) =>
          input.repository.saveMarketPriceObservations(observations),
        now: input.now?.() ?? new Date().toISOString(),
      });
      input.repository.saveMarketRefreshRecord({
        provider: input.provider.id,
        completedAt: result.refreshedAt,
        updated: result.updated,
        unchanged: result.unchanged,
        failed: result.failed.length,
        failures: result.failed,
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
    repository: getPortfolioRepository(),
    provider: new EastmoneyFundNavClient(),
  })();
}
