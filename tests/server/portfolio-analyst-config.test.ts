import { describe, expect, it } from "vitest";

import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

describe("portfolio analyst provider configuration", () => {
  it("uses dedicated model settings with narrative settings as a fallback", () => {
    const registry = getPortfolioAnalystProviderRegistry({
      OPENAI_API_KEY: "synthetic-openai-key",
      DEEPSEEK_API_KEY: "synthetic-deepseek-key",
      OPENAI_ANALYST_MODEL: "openai-analyst",
      DEEPSEEK_NARRATIVE_MODEL: "deepseek-narrative-fallback",
      PORTFOLIO_ANALYST_DEFAULT_PROVIDER: "deepseek",
    });

    expect(registry.models).toEqual({
      openai: "openai-analyst",
      deepseek: "deepseek-narrative-fallback",
    });
    expect(registry.defaultProvider).toBe("deepseek");
    expect(registry.providers.openai).toMatchObject({
      id: "openai",
      model: "openai-analyst",
    });
    expect(registry.providers.deepseek).toMatchObject({
      id: "deepseek",
      model: "deepseek-narrative-fallback",
    });
    expect(registry.agentRuntimes?.openai).toBeDefined();
    expect(registry.agentRuntimes?.deepseek).toBeDefined();
  });

  it("does not construct cloud providers without their server-side keys", () => {
    const registry = getPortfolioAnalystProviderRegistry({});

    expect(registry.providers).toEqual({});
    expect(registry.agentRuntimes).toEqual({});
    expect(registry.defaultProvider).toBe("openai");
    expect(registry.models).toEqual({
      openai: "gpt-6-luna",
      deepseek: "deepseek-v4-flash",
    });
  });
});
