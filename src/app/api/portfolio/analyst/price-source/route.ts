import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";
import { createAgentPriceSourceConfirmHandler } from "./handler";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { createProductionPriceSourceService } from "@/server/price-source-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const database = getPortfolioDatabase();
  return createAgentPriceSourceConfirmHandler({ database, service: createProductionPriceSourceService(database), respond: createPortfolioWorkflowReply(database) })(request);
}
