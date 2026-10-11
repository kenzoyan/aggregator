import { createPendingActionCancelHandler } from "./handler";
import { getPortfolioDatabase } from "@/server/portfolio-db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request) {
  return createPendingActionCancelHandler(getPortfolioDatabase())(request);
}
