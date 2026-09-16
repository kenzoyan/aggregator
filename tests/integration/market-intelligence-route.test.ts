import { describe, expect, it } from "vitest";

import { createMarketIntelligenceHandlers } from "@/app/api/market-intelligence/handler";
import type {
  MarketIntelligenceBrief,
  MarketIntelligenceProvider,
} from "@/application/market-intelligence";

const content = {
  windowStart: "2026-09-13",
  windowEnd: "2026-10-12",
  events: [{
    date: "2026-09-20",
    time: null,
    scheduledAt: null,
    region: "Euro area",
    category: "central-bank" as const,
    title: "ECB policy decision",
    summary: "The ECB is scheduled to publish a policy decision.",
    whyItMatters: "The decision can affect euro rates and asset valuations.",
    sources: [{ title: "ECB calendar", url: "https://www.ecb.europa.eu/press/calendars/html/index.en.html" }],
  }],
};

function store(initial?: MarketIntelligenceBrief) {
  let latest = initial;
  return {
    saveMarketIntelligenceBrief(brief: MarketIntelligenceBrief) { latest = brief; },
    readLatestMarketIntelligenceBrief() { return latest; },
  };
}

function provider(): MarketIntelligenceProvider {
  return { id: "openai", model: "gpt-synthetic", generate: async () => content };
}

describe("/api/market-intelligence", () => {
  it("returns configuration and generates a persisted brief on demand", async () => {
    const database = store();
    const handlers = createMarketIntelligenceHandlers({ provider: provider(), model: "gpt-synthetic" }, {
      database,
      now: () => "2026-09-13T12:00:00.000Z",
      createId: () => "market-brief-1",
    });

    await expect(handlers.GET().then((response) => response.json())).resolves.toEqual({
      configured: true,
      model: "gpt-synthetic",
    });
    const response = await handlers.POST(new Request("http://localhost/api/market-intelligence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "zh-CN" }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ brief: expect.objectContaining({
      version: "market-intelligence.v1",
      id: "market-brief-1",
      provider: "openai",
      model: "gpt-synthetic",
      language: "zh-CN",
      generatedAt: "2026-09-13T12:00:00.000Z",
      events: content.events,
    }) });
    expect(database.readLatestMarketIntelligenceBrief()).toEqual(expect.objectContaining({ id: "market-brief-1" }));
  });

  it("keeps the previous brief when refreshing fails", async () => {
    const previous = {
      version: "market-intelligence.v1",
      id: "previous",
      provider: "openai",
      model: "gpt-synthetic",
      language: "en",
      generatedAt: "2026-09-12T12:00:00.000Z",
      disclaimer: "External market information · Not investment advice",
      ...content,
    } as const satisfies MarketIntelligenceBrief;
    const database = store(previous);
    const failing = provider();
    failing.generate = async () => { throw new Error("offline"); };
    const handlers = createMarketIntelligenceHandlers({ provider: failing, model: "gpt-synthetic" }, { database });
    const response = await handlers.POST(new Request("http://localhost/api/market-intelligence", {
      method: "POST",
      body: JSON.stringify({ language: "en" }),
    }));

    expect(response.status).toBe(502);
    expect(database.readLatestMarketIntelligenceBrief()).toEqual(previous);
  });
});
