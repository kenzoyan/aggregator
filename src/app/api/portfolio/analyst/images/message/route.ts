import { createPortfolioAnalystImageHandlers } from "../handler";

import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return Response.json({ error: "OpenAI image analysis is not configured." }, { status: 503 });
  }
  return createPortfolioAnalystImageHandlers({
    conversations: getPortfolioDatabase(),
    images: createLocalPortfolioAnalystImageStore(),
  }).SEND(request);
}
