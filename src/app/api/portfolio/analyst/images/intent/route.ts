import { getAIEnvironment } from "@/server/ai-provider-settings";
import { createAgentImageIntentHandler } from "./handler";

import { createAgentImageIntentInterpreter } from "@/infrastructure/responses/agent-image-intent-interpreter";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const environment = getAIEnvironment();
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "OpenAI image analysis is not configured." }, { status: 503 });
  }
  const interpret = createAgentImageIntentInterpreter({
    apiKey,
    model: getPortfolioAnalystProviderRegistry().models.openai,
  });
  const database = getPortfolioDatabase();
  return createAgentImageIntentHandler({
    conversations: database,
    respond: createPortfolioWorkflowReply(database),
    readAccounts: () => database.readSourceAccounts(),
    interpret,
    imageModel: environment.OPENAI_IMAGE_QUESTION_MODEL?.trim()
      || environment.OPENAI_IMAGE_IMPORT_MODEL?.trim()
      || getPortfolioAnalystProviderRegistry().models.openai,
  })(request);
}
