import type {
  NarrativeProviderId,
  PortfolioNarrativeProvider,
} from "@/application/portfolio-narrative";
import { DeepSeekNarrativeProvider } from "@/infrastructure/deepseek/deepseek-narrative-provider";
import { OpenAINarrativeProvider } from "@/infrastructure/openai/openai-narrative-provider";

export interface PortfolioNarrativeProviderRegistry {
  providers: Partial<Record<NarrativeProviderId, PortfolioNarrativeProvider>>;
  models: Record<NarrativeProviderId, string>;
  defaultProvider: NarrativeProviderId;
}

function configuredSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getPortfolioNarrativeProviderRegistry(
  environment: NodeJS.ProcessEnv = process.env,
): PortfolioNarrativeProviderRegistry {
  const openAIModel = configuredSecret(environment.OPENAI_NARRATIVE_MODEL) ??
    "gpt-5.6-terra";
  const deepSeekModel = configuredSecret(environment.DEEPSEEK_NARRATIVE_MODEL) ??
    "deepseek-v4-flash";
  const openAIKey = configuredSecret(environment.OPENAI_API_KEY);
  const deepSeekKey = configuredSecret(environment.DEEPSEEK_API_KEY);
  const requestedDefault = configuredSecret(
    environment.PORTFOLIO_NARRATIVE_DEFAULT_PROVIDER,
  );
  const defaultProvider: NarrativeProviderId = requestedDefault === "deepseek"
    ? "deepseek"
    : "openai";

  return {
    providers: {
      ...(openAIKey
        ? {
            openai: new OpenAINarrativeProvider({
              apiKey: openAIKey,
              model: openAIModel,
            }),
          }
        : {}),
      ...(deepSeekKey
        ? {
            deepseek: new DeepSeekNarrativeProvider({
              apiKey: deepSeekKey,
              model: deepSeekModel,
            }),
          }
        : {}),
    },
    models: { openai: openAIModel, deepseek: deepSeekModel },
    defaultProvider,
  };
}
