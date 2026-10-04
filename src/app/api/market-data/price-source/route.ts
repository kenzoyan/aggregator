import { createPriceSourceHandler } from "@/app/api/market-data/price-source/handler";
import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";
import { getPortfolioDatabase } from "@/server/portfolio-db";

function handler() {
  return createPriceSourceHandler({
    database: getPortfolioDatabase(),
    fundNavProvider: new EastmoneyFundNavClient(),
  });
}

export async function GET(request: Request) {
  return handler().lookup(request);
}

export async function POST(request: Request) {
  return handler().confirm(request);
}
