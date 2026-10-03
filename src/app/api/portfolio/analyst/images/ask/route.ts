import { createPortfolioAnalystImageHandlers } from "../handler";

import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { createOpenAIImageQuestion } from "@/infrastructure/openai/openai-image-question";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "OpenAI image analysis is not configured." }, { status: 503 });
  }
  const model = process.env.OPENAI_IMAGE_QUESTION_MODEL?.trim()
    || process.env.OPENAI_IMAGE_IMPORT_MODEL?.trim()
    || getPortfolioAnalystProviderRegistry().models.openai;
  return createPortfolioAnalystImageHandlers({
    conversations: getPortfolioDatabase(),
    images: createLocalPortfolioAnalystImageStore(),
    imageQuestion: createOpenAIImageQuestion({ apiKey, model }),
    imageModel: model,
  }).ASK(request);
}
