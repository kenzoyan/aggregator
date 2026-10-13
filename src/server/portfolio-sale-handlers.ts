import { getAIEnvironment } from "@/server/ai-provider-settings";
import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";
import { createAgentSaleHandlers } from "@/app/api/portfolio/analyst/sale/handler";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { readPortfolioOverviewIncludingEmpty } from "@/server/current-portfolio";
import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { createOpenAISaleExtractor } from "@/infrastructure/openai/openai-sale-extractor";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";
import type { SaleDraftHolding } from "@/application/agent-sale-draft";
export function createPortfolioSaleHandlers(database: ReturnType<typeof getPortfolioDatabase>, withReply = true) {
  return createAgentSaleHandlers({
    ...(withReply ? { respond: createPortfolioWorkflowReply(database) } : {}),
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
      const environment = getAIEnvironment();
      const apiKey = environment.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OpenAI screenshot analysis is not configured.");
      return createOpenAISaleExtractor({ apiKey, model: environment.OPENAI_IMAGE_IMPORT_MODEL?.trim() || getPortfolioAnalystProviderRegistry().models.openai })(request);
    },
  });
}
