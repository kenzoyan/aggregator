import type {
  PortfolioAnalystProvider,
  PortfolioAnalystProviderId,
} from "@/application/portfolio-analyst-provider";
import { DeepSeekAnalystProvider } from "@/infrastructure/deepseek/deepseek-analyst-provider";
import { OpenAIAnalystProvider } from "@/infrastructure/openai/openai-analyst-provider";

export interface PortfolioAnalystProviderRegistry {
  providers: Partial<Record<PortfolioAnalystProviderId, PortfolioAnalystProvider>>;
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
    "gpt-5.6-terra";
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
    providers: {
      ...(openAIKey
        ? { openai: new OpenAIAnalystProvider({ apiKey: openAIKey, model: openAIModel }) }
        : {}),
      ...(deepSeekKey
        ? { deepseek: new DeepSeekAnalystProvider({ apiKey: deepSeekKey, model: deepSeekModel }) }
        : {}),
    },
    models: { openai: openAIModel, deepseek: deepSeekModel },
    defaultProvider,
  };
}
