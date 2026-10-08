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
  const openAIKey = configuredValue(environment.OPENAI_API_KEY);

  return {
    agentRuntimes: {
      ...(openAIKey
        ? { openai: createPiNativePortfolioAnalystRuntime({
            model: openAIModel,
            apiKey: openAIKey,
            webResearch: new OpenAIWebResearch({ apiKey: openAIKey, model: openAIModel }),
          }) }
        : {}),
    },
    models: { openai: openAIModel },
    defaultProvider: "openai",
  };
}
