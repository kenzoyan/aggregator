import { describe, expect, it } from "vitest";

import {
  defaultPortfolioAnalystPreferences,
  parsePortfolioAnalystPreferences,
  readPortfolioAnalystPreferences,
  resolvePortfolioAnalystConversationSettings,
  savePortfolioAnalystPreferences,
} from "@/application/portfolio-analyst-preferences";

describe("portfolio analyst preferences", () => {
  it("uses private local defaults when no saved value exists", () => {
    expect(defaultPortfolioAnalystPreferences("openai")).toEqual({
      version: "portfolio-agent-preferences.v2",
      provider: "openai",
      language: "en",
      defaultPeriod: "week",
      includeHoldingNames: true,
    });
  });

  it("restores valid preferences and ignores invalid fields", () => {
    expect(parsePortfolioAnalystPreferences(JSON.stringify({
      provider: "deepseek",
      language: "en",
      defaultPeriod: "month",
      includeHoldingNames: false,
    }), "openai")).toMatchObject({
      provider: "deepseek",
      language: "en",
      defaultPeriod: "month",
      includeHoldingNames: false,
    });

    expect(parsePortfolioAnalystPreferences(JSON.stringify({
      provider: "unknown",
      defaultPeriod: "year",
    }), "openai")).toEqual(defaultPortfolioAnalystPreferences("openai"));
  });

  it("falls back safely when browser storage contains malformed JSON", () => {
    expect(parsePortfolioAnalystPreferences("{", "deepseek"))
      .toEqual(defaultPortfolioAnalystPreferences("deepseek"));
  });

  it("saves and restores preferences in local browser storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const preferences = {
      ...defaultPortfolioAnalystPreferences("openai"),
      language: "en" as const,
      includeHoldingNames: false,
    };

    savePortfolioAnalystPreferences(storage, preferences);

    expect(readPortfolioAnalystPreferences(storage, "deepseek")).toEqual(preferences);
  });

  it("allows language changes while keeping an existing conversation's provider and privacy", () => {
    const preferences = {
      ...defaultPortfolioAnalystPreferences("deepseek"),
      language: "en" as const,
      includeHoldingNames: false,
    };
    const providers = [
      { id: "openai" as const, configured: true },
      { id: "deepseek" as const, configured: false },
    ];

    expect(resolvePortfolioAnalystConversationSettings({
      preferences,
      providers,
      fallbackProvider: "deepseek",
    })).toEqual({ provider: "openai", language: "en", includeHoldingNames: false });

    expect(resolvePortfolioAnalystConversationSettings({
      preferences,
      providers,
      fallbackProvider: "deepseek",
      conversation: {
        provider: "deepseek",
        language: "zh-CN",
        includeHoldingNames: true,
      },
    })).toEqual({ provider: "deepseek", language: "en", includeHoldingNames: true });
  });

  it("moves legacy preferences to English without losing other choices", () => {
    const storage = {
      getItem: (key: string) => key.endsWith(".v1")
        ? JSON.stringify({ provider: "deepseek", language: "zh-CN", defaultPeriod: "month", includeHoldingNames: false })
        : null,
    };
    expect(readPortfolioAnalystPreferences(storage, "openai")).toMatchObject({
      provider: "deepseek",
      language: "en",
      defaultPeriod: "month",
      includeHoldingNames: false,
    });
  });
});
