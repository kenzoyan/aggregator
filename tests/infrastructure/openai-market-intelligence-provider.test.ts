import { describe, expect, it } from "vitest";

import { MarketIntelligenceProviderError } from "@/application/market-intelligence";
import { OpenAIMarketIntelligenceProvider } from "@/infrastructure/openai/openai-market-intelligence-provider";

const sourceUrl = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const secondSourceUrl = "https://www.federalreserve.gov/newsevents/calendar.htm";

function response(source = sourceUrl) {
  const returnedSources = source === sourceUrl
    ? [
        { type: "url", url: sourceUrl, title: "Federal Reserve Board - Calendar" },
        { type: "url", url: secondSourceUrl, title: "Federal Reserve Board - News calendar" },
      ]
    : [{ type: "url", url: source, title: "ECB calendar" }];
  return Response.json({
    status: "completed",
    output: [
      {
        type: "web_search_call",
        action: { type: "search", sources: returnedSources },
      },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            windowStart: "2026-09-13",
            windowEnd: "2026-10-12",
            events: [{
              date: "2026-09-20",
              time: "14:00 ET",
              scheduledAt: "2026-09-20T14:00:00-04:00",
              region: "United States",
              category: "central-bank",
              title: "Federal Reserve policy decision",
              summary: "The Federal Reserve is scheduled to publish a policy decision.",
              whyItMatters: "Policy decisions can affect equity valuations and the euro-dollar exchange rate.",
              sourceUrls: [sourceUrl, secondSourceUrl],
            }],
          }),
          annotations: [{ type: "url_citation", url: source, title: "Federal Reserve Board - Calendar" }],
        }],
      },
    ],
  });
}

describe("OpenAI market intelligence provider", () => {
  it("requires web search, limits it to official domains and returns verified citations", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new OpenAIMarketIntelligenceProvider({
      apiKey: "synthetic-key",
      model: "gpt-synthetic",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return response();
      },
    });

    await expect(provider.generate({
      language: "en",
      now: "2026-09-13T12:00:00.000Z",
    })).resolves.toEqual({
      windowStart: "2026-09-13",
      windowEnd: "2026-10-12",
      events: [expect.objectContaining({
        title: "Federal Reserve policy decision",
        sources: [{ title: "Federal Reserve Board - Calendar", url: sourceUrl }],
      })],
    });

    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      model: "gpt-synthetic",
      store: false,
      tool_choice: "required",
      max_tool_calls: 4,
      include: ["web_search_call.action.sources"],
      tools: [{ type: "web_search", external_web_access: true }],
      text: { format: { type: "json_schema", name: "market_intelligence" } },
    });
    expect(body.tools[0].filters.allowed_domains).toContain("federalreserve.gov");
  });

  it("rejects a citation the web search did not actually return", async () => {
    const provider = new OpenAIMarketIntelligenceProvider({
      apiKey: "synthetic-key",
      model: "gpt-synthetic",
      fetch: async () => response("https://www.ecb.europa.eu/press/calendars/html/index.en.html"),
    });

    await expect(provider.generate({ language: "en", now: "2026-09-13T12:00:00.000Z" }))
      .rejects.toEqual(new MarketIntelligenceProviderError("invalid-response"));
  });
});
