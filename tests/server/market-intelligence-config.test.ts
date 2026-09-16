import { describe, expect, it } from "vitest";

import { getMarketIntelligenceRegistry } from "@/server/market-intelligence-config";

describe("market intelligence configuration", () => {
  it("uses a dedicated model and only configures search with a server-side key", () => {
    const configured = getMarketIntelligenceRegistry({
      OPENAI_API_KEY: "synthetic-key",
      OPENAI_MARKET_INTELLIGENCE_MODEL: "market-model",
      OPENAI_ANALYST_MODEL: "analyst-model",
    });
    expect(configured).toMatchObject({ model: "market-model", provider: { id: "openai", model: "market-model" } });

    expect(getMarketIntelligenceRegistry({ OPENAI_ANALYST_MODEL: "analyst-model" }))
      .toEqual({ model: "analyst-model" });
  });
});
