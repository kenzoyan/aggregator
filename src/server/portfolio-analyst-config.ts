import type { PortfolioAnalystProviderId } from "@/application/portfolio-analyst-provider";
import type { PortfolioAnalystAgentRuntime } from "@/application/portfolio-analyst-agent";
import { OpenAIWebResearch } from "@/infrastructure/openai/openai-web-research";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";

export interface PortfolioAnalystProviderRegistry {
  agentRuntimes: Partial<Record<PortfolioAnalystProviderId, PortfolioAnalystAgentRuntime>>;
  models: Record<PortfolioAnalystProviderId, string>;
  defaultProvider: PortfolioAnalystProviderId;
}

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function getPortfolioAnalystProviderRegistry(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PortfolioAnalystProviderRegistry {
  const openAIModel = configuredValue(environment.OPENAI_ANALYST_MODEL) ??
    configuredValue(environment.OPENAI_NARRATIVE_MODEL) ??
    "gpt-6-luna";
  const deepSeekModel = configuredValue(environment.DEEPSEEK_ANALYST_MODEL) ??
    configuredValue(environment.DEEPSEEK_NARRATIVE_MODEL) ??
    "deepseek-v4-flash";
  const requestedDefault = configuredValue(
    environment.PORTFOLIO_ANALYST_DEFAULT_PROVIDER,
  ) ?? configuredValue(environment.PORTFOLIO_NARRATIVE_DEFAULT_PROVIDER);
  const defaultProvider: PortfolioAnalystProviderId = requestedDefault === "deepseek"
    ? "deepseek"
    : "openai";
  const openAIKey = configuredValue(environment.OPENAI_API_KEY);
  const deepSeekKey = configuredValue(environment.DEEPSEEK_API_KEY);

  return {
    agentRuntimes: {
      ...(openAIKey
        ? { openai: createPiNativePortfolioAnalystRuntime({
            provider: "openai",
            model: openAIModel,
            apiKey: openAIKey,
            webResearch: new OpenAIWebResearch({ apiKey: openAIKey, model: openAIModel }),
          }) }
        : {}),
      ...(deepSeekKey
        ? { deepseek: createPiNativePortfolioAnalystRuntime({
            provider: "deepseek",
            model: deepSeekModel,
            apiKey: deepSeekKey,
          }) }
        : {}),
    },
    models: { openai: openAIModel, deepseek: deepSeekModel },
    defaultProvider,
  };
}
