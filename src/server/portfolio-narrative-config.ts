import { getAIEnvironment } from "@/server/ai-provider-settings";
import type {
  NarrativeProviderId,
  PortfolioNarrativeProvider,
} from "@/application/portfolio-narrative";
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
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PortfolioNarrativeProviderRegistry {
  environment = getAIEnvironment(environment);
  const openAIModel = configuredSecret(environment.OPENAI_NARRATIVE_MODEL) ??
    "gpt-5.6-terra";
  const openAIKey = configuredSecret(environment.OPENAI_API_KEY);

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
    },
    models: { openai: openAIModel },
    defaultProvider: "openai",
  };
}
