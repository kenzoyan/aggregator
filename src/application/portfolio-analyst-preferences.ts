import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystProviderId } from "@/application/portfolio-analyst-provider";
import type { Period } from "@/application/portfolio-read-model";

export const portfolioAnalystPreferencesStorageKey = "invest-monitor.portfolio-agent-preferences.v1";

export interface PortfolioAnalystPreferences {
  version: "portfolio-agent-preferences.v1";
  provider: PortfolioAnalystProviderId;
  language: PortfolioAnalystLanguage;
  defaultPeriod: Period;
  includeHoldingNames: boolean;
}

export interface PortfolioAnalystProviderAvailability {
  id: PortfolioAnalystProviderId;
  configured: boolean;
}

export interface PortfolioAnalystConversationSettings {
  provider: PortfolioAnalystProviderId;
  language: PortfolioAnalystLanguage;
  includeHoldingNames: boolean;
}

export function defaultPortfolioAnalystPreferences(
  provider: PortfolioAnalystProviderId,
): PortfolioAnalystPreferences {
  return {
    version: "portfolio-agent-preferences.v1",
    provider,
    language: "zh-CN",
    defaultPeriod: "week",
    includeHoldingNames: true,
  };
}

export function parsePortfolioAnalystPreferences(
  value: string | null,
  fallbackProvider: PortfolioAnalystProviderId,
): PortfolioAnalystPreferences {
  const fallback = defaultPortfolioAnalystPreferences(fallbackProvider);
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as Partial<PortfolioAnalystPreferences>;
    return {
      ...fallback,
      provider: parsed.provider === "openai" || parsed.provider === "deepseek"
        ? parsed.provider
        : fallback.provider,
      language: parsed.language === "en" || parsed.language === "zh-CN"
        ? parsed.language
        : fallback.language,
      defaultPeriod: parsed.defaultPeriod === "today" ||
          parsed.defaultPeriod === "week" ||
          parsed.defaultPeriod === "month"
        ? parsed.defaultPeriod
        : fallback.defaultPeriod,
      includeHoldingNames: typeof parsed.includeHoldingNames === "boolean"
        ? parsed.includeHoldingNames
        : fallback.includeHoldingNames,
    };
  } catch {
    return fallback;
  }
}

export function readPortfolioAnalystPreferences(
  storage: Pick<Storage, "getItem">,
  fallbackProvider: PortfolioAnalystProviderId,
): PortfolioAnalystPreferences {
  try {
    return parsePortfolioAnalystPreferences(
      storage.getItem(portfolioAnalystPreferencesStorageKey),
      fallbackProvider,
    );
  } catch {
    return defaultPortfolioAnalystPreferences(fallbackProvider);
  }
}

export function savePortfolioAnalystPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: PortfolioAnalystPreferences,
): void {
  storage.setItem(portfolioAnalystPreferencesStorageKey, JSON.stringify(preferences));
}

export function resolvePortfolioAnalystConversationSettings(input: {
  preferences: PortfolioAnalystPreferences;
  providers: readonly PortfolioAnalystProviderAvailability[];
  fallbackProvider: PortfolioAnalystProviderId;
  conversation?: PortfolioAnalystConversationSettings;
}): PortfolioAnalystConversationSettings {
  if (input.conversation) return input.conversation;
  const selected = input.providers.find((item) =>
    item.id === input.preferences.provider && item.configured
  ) ?? input.providers.find((item) => item.configured);
  return {
    provider: selected?.id ?? input.fallbackProvider,
    language: input.preferences.language,
    includeHoldingNames: input.preferences.includeHoldingNames,
  };
}
