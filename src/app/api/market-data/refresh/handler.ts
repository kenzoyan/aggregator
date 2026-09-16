import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  createMarketDataRefresh,
  type MarketDataRefreshDependencies,
  type MarketDataRefreshMode,
} from "@/application/market-data-refresh";
import { trading212SourceAccountId } from "@/domain/source-accounts";
import { DanskeInvestFundNavClient } from "@/infrastructure/danske-invest/danske-invest-fund-nav-client";
import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";
import { PortfolioFundNavClient } from "@/infrastructure/fund-nav/portfolio-fund-nav-client";
import { Trading212Client } from "@/infrastructure/trading212/trading212-client";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { getDanskeInvestFundRoutes } from "@/server/danske-invest-config";
import { getTrading212ConnectionConfig } from "@/server/trading212-config";

export function createMarketRefreshHandler(
  input: Omit<MarketDataRefreshDependencies, "fundNavProvider"> & {
    provider: MarketDataRefreshDependencies["fundNavProvider"];
    logError?: (message: string, error: unknown) => void;
  },
) {
  const refresh = createMarketDataRefresh({
    database: input.database,
    fundNavProvider: input.provider,
    refreshTrading212Snapshot: input.refreshTrading212Snapshot,
    now: input.now,
  });
  return async function handleMarketRefresh(options: {
    mode?: MarketDataRefreshMode;
  } = {}) {
    try {
      return NextResponse.json(await refresh(options.mode));
    } catch (error) {
      (input.logError ?? console.error)("Market data refresh failed", error);
      return NextResponse.json(
        { error: "Market data refresh could not be completed" },
        { status: 500 },
      );
    }
  };
}

let marketRefreshHandler: ReturnType<typeof createMarketRefreshHandler> | undefined;

function getMarketRefreshHandler() {
  if (marketRefreshHandler) return marketRefreshHandler;
  const trading212Config = getTrading212ConnectionConfig(trading212SourceAccountId);
  marketRefreshHandler = createMarketRefreshHandler({
    database: getPortfolioDatabase(),
    provider: new PortfolioFundNavClient([
      new EastmoneyFundNavClient(),
      new DanskeInvestFundNavClient({
        fundRoutes: getDanskeInvestFundRoutes(),
      }),
    ]),
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
