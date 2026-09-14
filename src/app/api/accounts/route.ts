import { createAccountsHandlers } from "@/app/api/accounts/handler";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import {
  getTrading212ConnectionConfig,
  trading212Environment,
} from "@/server/trading212-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getProductionHandlers() {
  return createAccountsHandlers({
    database: getPortfolioDatabase(),
    trading212Configuration: getTrading212ConnectionConfig,
    trading212Environment,
  });
}

export async function GET() {
  return getProductionHandlers().GET();
}

export async function PATCH(request: Request) {
  return getProductionHandlers().PATCH(request);
}
