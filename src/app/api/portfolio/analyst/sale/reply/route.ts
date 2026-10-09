import { createWorkflowReplyHandler } from "./handler";
import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";
import { getPortfolioDatabase } from "@/server/portfolio-db";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const database = getPortfolioDatabase();
  return createWorkflowReplyHandler({ conversations: database, generate: createPortfolioWorkflowReply(database) })(request);
}
