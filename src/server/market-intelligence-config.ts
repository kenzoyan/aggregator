import { getAIEnvironment } from "@/server/ai-provider-settings";
import type { MarketIntelligenceProvider } from "@/application/market-intelligence";
import { OpenAIMarketIntelligenceProvider } from "@/infrastructure/openai/openai-market-intelligence-provider";

export interface MarketIntelligenceRegistry {
  provider?: MarketIntelligenceProvider;
  model: string;
}

function configured(value: string | undefined) {
  return value?.trim() || undefined;
}

export function getMarketIntelligenceRegistry(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): MarketIntelligenceRegistry {
  environment = getAIEnvironment(environment);
  const model = configured(environment.OPENAI_MARKET_INTELLIGENCE_MODEL) ??
    configured(environment.OPENAI_ANALYST_MODEL) ??
    configured(environment.OPENAI_NARRATIVE_MODEL) ??
    "gpt-5.6-terra";
  const apiKey = configured(environment.OPENAI_API_KEY);
  return {
    model,
    ...(apiKey ? { provider: new OpenAIMarketIntelligenceProvider({ apiKey, model }) } : {}),
  };
}
