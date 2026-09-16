import { describe, expect, it } from "vitest";

import { requestStructuredResponse } from "@/infrastructure/responses/structured-response-client";

describe("structured response client", () => {
  it("passes response extensions through and exposes the provider envelope", async () => {
    const requests: RequestInit[] = [];
    const providerEnvelope = {
      status: "completed",
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [{
              url: "https://www.ecb.europa.eu/press/calendars/html/index.en.html",
              title: "ECB calendar",
            }],
          },
        },
        {
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify({ events: [] }),
            annotations: [{
              type: "url_citation",
              url: "https://ec.europa.eu/eurostat/news/release-calendar",
              title: "Eurostat release calendar",
            }],
          }],
        },
      ],
    };

    const result = await requestStructuredResponse({
      endpoint: "https://api.openai.com/v1/responses",
      apiKey: "synthetic-key",
      model: "gpt-synthetic",
      instructions: "Use official sources.",
      prompt: "Find scheduled events.",
      schemaName: "scheduled_events",
      jsonSchema: { type: "object" },
      reasoningEffort: "none",
      maxOutputTokens: 700,
      timeoutMs: 1_000,
      store: false,
      tools: [{ type: "web_search", filters: { allowed_domains: ["ecb.europa.eu"] } }],
      toolChoice: "required",
      maxToolCalls: 4,
      include: ["web_search_call.action.sources"],
      parse: (payload, responseEnvelope) => ({ payload, responseEnvelope }),
      fetch: async (_input, init) => {
        requests.push(init ?? {});
        return Response.json(providerEnvelope);
      },
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      tool_choice: "required",
      max_tool_calls: 4,
      include: ["web_search_call.action.sources"],
      tools: [{ type: "web_search", filters: { allowed_domains: ["ecb.europa.eu"] } }],
    });
    expect(result).toEqual({
      payload: { events: [] },
      responseEnvelope: providerEnvelope,
    });
  });
});
