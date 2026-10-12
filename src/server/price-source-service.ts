import { createPriceSourceService, type PriceSourceDatabase } from "@/application/price-source-service";
import { createAgentPriceSourceDiscovery } from "@/application/agent-price-source-discovery";
import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";
import { FinancialTimesFundNavClient } from "@/infrastructure/financial-times/financial-times-fund-nav-client";
import { OpenAIPriceSourceResearch } from "@/infrastructure/openai/openai-price-source-research";

export function createProductionPriceSourceService(database: PriceSourceDatabase) {
  return createPriceSourceService({ database, fundNavProvider: new EastmoneyFundNavClient(),
    priceSourceProviders: { "financial-times": new FinancialTimesFundNavClient() } });
}
export function createProductionPriceSourceDiscovery(database: PriceSourceDatabase) {
  return createAgentPriceSourceDiscovery({ database, service: createProductionPriceSourceService(database),
    research: new OpenAIPriceSourceResearch({ apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
      model: process.env.OPENAI_ANALYST_MODEL?.trim() || process.env.OPENAI_NARRATIVE_MODEL?.trim() || "gpt-6-luna" }) });
}
