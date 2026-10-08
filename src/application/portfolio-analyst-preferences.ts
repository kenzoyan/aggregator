import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystProviderId } from "@/application/portfolio-analyst-provider";
import type { Period } from "@/application/portfolio-read-model";

export const portfolioAnalystPreferencesStorageKey = "invest-monitor.portfolio-agent-preferences.v2";
const legacyPreferencesStorageKey = "invest-monitor.portfolio-agent-preferences.v1";

export interface PortfolioAnalystPreferences {
  version: "portfolio-agent-preferences.v2";
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
    version: "portfolio-agent-preferences.v2",
    provider,
    language: "en",
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
      provider: "openai",
      language: parsed.language === "en" || parsed.language === "zh-CN"
        ? parsed.language
        : fallback.language,
      defaultPeriod: parsed.defaultPeriod === "today" ||
          parsed.defaultPeriod === "week" ||
          parsed.defaultPeriod === "month"
        ? parsed.defaultPeriod
        : fallback.defaultPeriod,
      includeHoldingNames: true,
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
    const current = storage.getItem(portfolioAnalystPreferencesStorageKey);
    if (current) return parsePortfolioAnalystPreferences(current, fallbackProvider);
    const legacy = storage.getItem(legacyPreferencesStorageKey);
    return legacy
      ? { ...parsePortfolioAnalystPreferences(legacy, fallbackProvider), language: "en" }
      : defaultPortfolioAnalystPreferences(fallbackProvider);
  } catch {
    return defaultPortfolioAnalystPreferences(fallbackProvider);
  }
}

export function savePortfolioAnalystPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: PortfolioAnalystPreferences,
): void {
  storage.setItem(portfolioAnalystPreferencesStorageKey, JSON.stringify({ ...preferences, includeHoldingNames: true }));
}

export function resolvePortfolioAnalystConversationSettings(input: {
  preferences: PortfolioAnalystPreferences;
  providers: readonly PortfolioAnalystProviderAvailability[];
  fallbackProvider: PortfolioAnalystProviderId;
  conversation?: PortfolioAnalystConversationSettings;
}): PortfolioAnalystConversationSettings {
  if (input.conversation) return { ...input.conversation, provider: "openai", language: input.preferences.language, includeHoldingNames: true };
  const selected = input.providers.find((item) =>
    item.id === input.preferences.provider && item.configured
  ) ?? input.providers.find((item) => item.configured);
  return {
    provider: selected?.id ?? input.fallbackProvider,
    language: input.preferences.language,
    includeHoldingNames: true,
  };
}
