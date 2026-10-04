import { describe, expect, it, vi } from "vitest";

import { OpenAIWebResearch } from "@/infrastructure/openai/openai-web-research";

function response(findings: unknown, sources: string[], searched = true) {
  return new Response(JSON.stringify({
    status: "completed",
    output: [
      ...(searched ? [{
        type: "web_search_call",
        action: { sources: sources.map((url) => ({ url, title: "Official product page" })) },
      }] : []),
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ findings }) }] },
    ],
  }), { status: 200 });
}

describe("web research", () => {
  it("searches without a domain allowlist and accepts a source returned by the web tool", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response([{
      title: "Nasdaq", url: "https://www.nasdaq.com/market-activity/index/comp",
      summary: "The index page reports a dated close.",
    }], ["https://www.nasdaq.com/market-activity/index/comp"]));
    const search = new OpenAIWebResearch({
      apiKey: "synthetic-key", model: "test-model", fetch: fetch as typeof globalThis.fetch,
      now: () => "2026-10-04T10:00:00.000Z",
    });
    expect(await search.search({ query: "Fund C share class", language: "en" })).toMatchObject({
      status: "completed",
      retrievedAt: "2026-10-04T10:00:00.000Z",
      findings: [{ title: "Official product page", summary: "The index page reports a dated close." }],
    });
    const request = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(request.store).toBe(false);
    expect(request.tools[0].filters).toBeUndefined();
    expect(request.include).toEqual(["web_search_call.action.sources"]);
  });

  it("does not pass through a model-invented or unsafe URL", async () => {
    const invented = new OpenAIWebResearch({
      apiKey: "synthetic-key", model: "test-model",
      fetch: vi.fn(async () => response([{
        title: "Fund C", url: "https://www.cmfchina.com/fabricated",
        summary: "Invented summary",
      }], ["https://www.cmfchina.com/real"])) as typeof globalThis.fetch,
    });
    expect((await invented.search({ query: "Fund C", language: "en" })).status).toBe("unavailable");

    const unsafe = new OpenAIWebResearch({
      apiKey: "synthetic-key", model: "test-model",
      fetch: vi.fn(async () => response([{
        title: "Private address", url: "https://127.0.0.1/fund",
        summary: "Unsafe",
      }], ["https://127.0.0.1/fund"])) as typeof globalThis.fetch,
    });
    expect((await unsafe.search({ query: "Fund C", language: "en" })).findings).toEqual([]);
  });

  it("requires an actual web search call", async () => {
    const search = new OpenAIWebResearch({
      apiKey: "synthetic-key", model: "test-model",
      fetch: vi.fn(async () => response([], [], false)) as typeof globalThis.fetch,
    });
    expect((await search.search({ query: "Fund C", language: "en" })).status).toBe("unavailable");
  });
});
