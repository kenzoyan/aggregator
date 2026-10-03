import { createPortfolioAnalystImageHandlers } from "./handler";

import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return createPortfolioAnalystImageHandlers({
    conversations: getPortfolioDatabase(),
    images: createLocalPortfolioAnalystImageStore(),
  }).POST(request);
}
