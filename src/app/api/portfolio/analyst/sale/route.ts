import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";
import { createAgentSaleHandlers } from "./handler";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { readPortfolioOverviewIncludingEmpty } from "@/server/current-portfolio";
import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { createOpenAISaleExtractor } from "@/infrastructure/openai/openai-sale-extractor";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";
import type { SaleDraftHolding } from "@/application/agent-sale-draft";
export const runtime = "nodejs";
function handlers() {
  const database = getPortfolioDatabase();
  return createAgentSaleHandlers({
    respond: createPortfolioWorkflowReply(database),
    conversations: database, images: createLocalPortfolioAnalystImageStore(),
    readFacts: () => database.readPortfolioFacts(),
    readHoldings: () => {
      const accounts = database.readSourceAccounts();
      return readPortfolioOverviewIncludingEmpty(database, new Date().toISOString()).holdings.flatMap((holding): SaleDraftHolding[] =>
        holding.holdingKey ? [{
          sourceAccountId: holding.holdingKey.sourceAccountId, instrumentId: holding.holdingKey.instrumentId,
          accountName: accounts.find((account) => account.id === holding.sourceAccountId)?.label ?? holding.source,
          name: holding.name, symbol: holding.symbol, currency: holding.currency,
          isFund: holding.category === "Fund", prices: holding.detail?.priceHistory ?? [],
        }] : []);
    },
    confirmSale: (...args) => database.confirmSale(...args),
    extract: (request) => {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OpenAI screenshot analysis is not configured.");
      return createOpenAISaleExtractor({ apiKey, model: process.env.OPENAI_IMAGE_IMPORT_MODEL?.trim() || getPortfolioAnalystProviderRegistry().models.openai })(request);
    },
  });
}
export async function GET(request: Request) { return handlers().GET(request); }
export async function POST(request: Request) { return handlers().POST(request); }
export async function PATCH(request: Request) { return handlers().PATCH(request); }
export async function PUT(request: Request) { return handlers().PUT(request); }
