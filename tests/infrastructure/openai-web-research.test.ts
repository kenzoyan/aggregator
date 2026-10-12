import { describe, expect, it, vi } from "vitest";

import { OpenAIWebResearch } from "@/infrastructure/openai/openai-web-research";
import { webResearchContext } from "@/application/portfolio-web-research";

function response(findings: unknown, sources: string[], searched = true) {
  return new Response(JSON.stringify({
    status: "completed",
    output: [
      ...(searched ? [{
        type: "web_search_call",
        action: { sources: sources.map((url) => ({ url, title: "Official product page" })) },
      }] : []),
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ findings: Array.isArray(findings)
        ? findings.map((finding) => ({ publishedAt: null, eventAsOf: null, ...finding })) : findings }) }] },
    ],
  }), { status: 200 });
}

describe("web research", () => {
  it("distinguishes missing provider URLs from returned URLs with no selected summary", async () => {
    for (const sources of [[], ["https://www.granlund.fi/en/"]]) {
      const search = new OpenAIWebResearch({ apiKey: "synthetic", model: "test",
        fetch: vi.fn(async () => response([], sources)) as typeof globalThis.fetch });
      const result = await search.search({ query: "Granlund company information", language: "en" });
      expect(result).toMatchObject({
        status: "completed", findings: [], diagnostics: {
          reason: sources.length ? "no-selected-findings" : "no-source-urls",
          returnedSourceCount: sources.length, candidateFindingCount: 0, verifiedFindingCount: 0,
        },
      });
      expect(webResearchContext({ result, factsAsOf: "2026-10-11T12:00:00Z", language: "en" }).facts[0]).toMatchObject({
        kind: "web-research-status", state: "no-verified-source", diagnostics: result.diagnostics,
      });
    }
  });

  it("preserves a safe provider failure category separately from an empty search", async () => {
    const search = new OpenAIWebResearch({ apiKey: "synthetic", model: "test",
      fetch: vi.fn(async () => new Response("", { status: 429 })) as typeof globalThis.fetch });
    expect(await search.search({ query: "Company information", language: "en" })).toMatchObject({
      status: "unavailable", diagnostics: { reason: "provider-error", errorCode: "rate-limited" },
    });
  });

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
    expect(request.instructions).toContain("do not require publication today");
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

  it("keeps historical event dates separate from later publication dates and filters unrelated events", async () => {
    const url = "https://www.ecb.europa.eu/press/test";
    const fetch = vi.fn(async () => response([
      { title: "Retrospective", url, summary: "A later report discusses the historical event.", publishedAt: "2026-10-11", eventAsOf: "2026-09-18" },
      { title: "Wrong period", url, summary: "An unrelated current event.", publishedAt: "2026-10-11", eventAsOf: "2026-10-11" },
      { title: "Undated", url, summary: "Timing is not established.", publishedAt: null, eventAsOf: null },
    ], [url]));
    const result = await new OpenAIWebResearch({ apiKey: "synthetic", model: "test", fetch: fetch as typeof globalThis.fetch,
      now: () => "2026-10-12T00:00:00Z" }).search({ query: "September event", language: "en", dateRange: { from: "2026-09-01", to: "2026-09-30" } });
    expect(result.status).toBe("completed");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({ publishedAt: "2026-10-11", eventAsOf: "2026-09-18" });
    expect(result.findings[1]).toMatchObject({ publishedAt: null, eventAsOf: null });
    expect(result.retrievedAt).toBe("2026-10-12T00:00:00Z");
  });

  it("rejects impossible source dates and invalid date windows without inventing a replacement", async () => {
    const url = "https://www.ecb.europa.eu/press/test";
    const fetch = vi.fn(async () => response([{ title: "Bad date", url, summary: "Invalid date", publishedAt: "2026-02-30", eventAsOf: null }], [url]));
    const search = new OpenAIWebResearch({ apiKey: "synthetic", model: "test", fetch: fetch as typeof globalThis.fetch });
    expect((await search.search({ query: "Historical event", language: "en" })).status).toBe("unavailable");
    fetch.mockClear();
    expect((await search.search({ query: "Historical event", language: "en", dateRange: { from: "2026-10-11", to: "2026-09-01" } })).status).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps independently verified findings when another URL was reconstructed", async () => {
    const verified = "https://www.ecb.europa.eu/press/verified?version=1";
    const search = new OpenAIWebResearch({ apiKey: "synthetic", model: "test", fetch: vi.fn(async () => response([
      { title: "Verified", url: verified, summary: "Verified source", publishedAt: "2024-09-18", eventAsOf: "2024-09-18" },
      { title: "Reconstructed", url: "https://www.ecb.europa.eu/press/other", summary: "Not the returned URL" },
    ], [verified, "https://www.ecb.europa.eu/press/other?version=2"])) as typeof globalThis.fetch });
    const result = await search.search({ query: "Historical event", language: "en" });
    expect(result.status).toBe("completed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].url).toBe(verified);
  });
});
