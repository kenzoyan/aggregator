import { createPortfolioAnalystImageHandlers } from "../handler";

import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return createPortfolioAnalystImageHandlers({
    conversations: getPortfolioDatabase(),
    images: createLocalPortfolioAnalystImageStore(),
  }).GET(id);
}
