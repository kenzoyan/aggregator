import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  refreshFundNavs,
  supportsFundNavRefresh,
} from "@/application/market-refresh";
import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import { marketObservationsFromTrading212Snapshot } from "@/application/trading212-market-data";
import type { FundNavProvider, MarketPriceObservation } from "@/domain/market-data";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";
import { trading212SourceAccountId } from "@/domain/source-accounts";
import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { Trading212Client } from "@/infrastructure/trading212/trading212-client";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { getTrading212ConnectionConfig } from "@/server/trading212-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketRefreshDatabase = Pick<
  PortfolioDatabase,
  "readPortfolioFacts" | "readMarketData" | "recordMarketData"
>;

export function createMarketRefreshHandler(input: {
  database: MarketRefreshDatabase;
  provider: FundNavProvider;
  refreshTrading212Snapshot?: () => Promise<OpeningSnapshotInput | undefined>;
  now?: () => string;
}) {
  let automaticRefreshTail = Promise.resolve();

  async function performMarketRefresh(options: {
    mode?: "manual" | "automatic";
  } = {}) {
    try {
      const now = input.now?.() ?? new Date().toISOString();
      const automatic = options.mode === "automatic";
      const marketData = input.database.readMarketData();
      if (
        automatic &&
        marketData.latestMarketRefresh &&
        portfolioCalendarDate(marketData.latestMarketRefresh.completedAt) ===
          portfolioCalendarDate(now)
      ) {
        return NextResponse.json({
          automatic: true,
          skipped: true,
          reason: "already-refreshed-today",
          lastRefreshedAt: marketData.latestMarketRefresh.completedAt,
        });
      }
      const facts = input.database.readPortfolioFacts();
      const hasRefreshablePosition = facts.state.positions.some((position) =>
        supportsFundNavRefresh(position) ||
        (Boolean(input.refreshTrading212Snapshot) &&
          position.sourceAccountId === trading212SourceAccountId)
      );
      if (automatic && !hasRefreshablePosition) {
        return NextResponse.json({
          automatic: true,
          skipped: true,
          reason: "no-refreshable-positions",
        });
      }
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
        now,
      });
      let trading212Updated = 0;
      let trading212Included = false;
      const trading212Failures = [];
      if (input.refreshTrading212Snapshot) {
        try {
          const snapshot = await input.refreshTrading212Snapshot();
          if (snapshot) {
            trading212Included = true;
            const confirmedPositionIds = new Set(
              facts.state.positions
                .filter((position) =>
                  position.sourceAccountId === snapshot.sourceAccountId
                )
                .map((position) => position.instrumentId),
            );
            const refreshed = marketObservationsFromTrading212Snapshot(snapshot)
              .filter((observation) =>
                confirmedPositionIds.has(observation.instrumentId)
              );
            observations.push(...refreshed);
            trading212Updated = refreshed.length;
          }
        } catch (error) {
          trading212Included = true;
          trading212Failures.push({
            instrumentCode: "Trading 212",
            message: error instanceof Error
              ? error.message
              : "Trading 212 price refresh failed",
          });
        }
      }
      const combinedResult = {
        ...result,
        automatic,
        updated: result.updated + trading212Updated,
        recordedPrices: result.recordedPrices + trading212Updated,
        skipped: Math.max(0, result.skipped - trading212Updated),
        failed: [...result.failed, ...trading212Failures],
      };
      input.database.recordMarketData({
        observations,
        refresh: {
          provider: `${input.provider.id}${trading212Included ? "+trading212" : ""}`,
          completedAt: combinedResult.refreshedAt,
          updated: combinedResult.updated,
          unchanged: combinedResult.unchanged,
          failed: combinedResult.failed.length,
          failures: combinedResult.failed,
        },
      });
      return NextResponse.json(combinedResult);
    } catch (error) {
      console.error("Market data refresh failed", error);
      return NextResponse.json(
        { error: "Market data refresh could not be completed" },
        { status: 500 },
      );
    }
  }

  return async function handleMarketRefresh(options: {
    mode?: "manual" | "automatic";
  } = {}) {
    if (options.mode !== "automatic") return performMarketRefresh(options);

    const previousAutomaticRefresh = automaticRefreshTail;
    let releaseAutomaticRefresh!: () => void;
    automaticRefreshTail = new Promise<void>((resolve) => {
      releaseAutomaticRefresh = resolve;
    });
    await previousAutomaticRefresh;
    try {
      return await performMarketRefresh(options);
    } finally {
      releaseAutomaticRefresh();
    }
  };
}

let marketRefreshHandler: ReturnType<typeof createMarketRefreshHandler> | undefined;

function getMarketRefreshHandler() {
  if (marketRefreshHandler) return marketRefreshHandler;
  const trading212Config = getTrading212ConnectionConfig(trading212SourceAccountId);
  marketRefreshHandler = createMarketRefreshHandler({
    database: getPortfolioDatabase(),
    provider: new EastmoneyFundNavClient(),
    ...(trading212Config
      ? {
          refreshTrading212Snapshot: () =>
            new Trading212Client(trading212Config).fetchAccountSnapshot({
              id: randomUUID(),
              sourceAccountId: trading212SourceAccountId,
            }),
        }
      : {}),
  });
  return marketRefreshHandler;
}

export async function POST(request: Request) {
  const mode = new URL(request.url).searchParams.get("mode") === "automatic"
    ? "automatic"
    : "manual";
  return getMarketRefreshHandler()({ mode });
}
