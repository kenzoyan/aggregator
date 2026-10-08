import { describe, expect, it } from "vitest";

import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

describe("portfolio analyst provider configuration", () => {
  it("uses the OpenAI analyst model with the narrative model as a fallback", () => {
    const registry = getPortfolioAnalystProviderRegistry({
      OPENAI_API_KEY: "synthetic-openai-key",
      OPENAI_ANALYST_MODEL: "openai-analyst",
    });

    expect(registry.models).toEqual({ openai: "openai-analyst" });
    expect(registry.defaultProvider).toBe("openai");
    expect(registry.agentRuntimes.openai).toBeDefined();
  });

  it("does not construct cloud providers without their server-side keys", () => {
    const registry = getPortfolioAnalystProviderRegistry({});

    expect(registry.agentRuntimes).toEqual({});
    expect(registry.defaultProvider).toBe("openai");
    expect(registry.models).toEqual({ openai: "gpt-6-luna" });
  });
});
