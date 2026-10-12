import { VerifiedDanskeFundNavClient } from "@/infrastructure/danske-invest/verified-danske-fund-nav-client";
import { NordeaFundNavClient } from "@/infrastructure/nordea/nordea-fund-nav-client";
import { createPriceSourceService, type PriceSourceDatabase } from "@/application/price-source-service";
import { createAgentPriceSourceDiscovery } from "@/application/agent-price-source-discovery";
import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";
import { FinancialTimesFundNavClient } from "@/infrastructure/financial-times/financial-times-fund-nav-client";
import { OpenAIPriceSourceResearch } from "@/infrastructure/openai/openai-price-source-research";

export function createProductionPriceSourceProviders() {
  return { "financial-times": new FinancialTimesFundNavClient(), "danske-invest": new VerifiedDanskeFundNavClient(), "nordea-funds": new NordeaFundNavClient() };
}
export function createProductionPriceSourceService(database: PriceSourceDatabase) {
  return createPriceSourceService({ database, fundNavProvider: new EastmoneyFundNavClient(),
    priceSourceProviders: createProductionPriceSourceProviders() });
}
export function createProductionPriceSourceDiscovery(database: PriceSourceDatabase) {
  return createAgentPriceSourceDiscovery({ database, service: createProductionPriceSourceService(database),
    research: new OpenAIPriceSourceResearch({ apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
      model: process.env.OPENAI_ANALYST_MODEL?.trim() || process.env.OPENAI_NARRATIVE_MODEL?.trim() || "gpt-6-luna" }) });
}
