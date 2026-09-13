import { z } from "zod";

import {
  createMarketIntelligenceInstructions,
  createMarketIntelligenceWindow,
  marketIntelligenceCandidateSchema,
  marketIntelligenceJsonSchema,
  marketIntelligenceOfficialDomains,
  MarketIntelligenceProviderError,
  type MarketIntelligenceProvider,
  type MarketIntelligenceSource,
} from "@/application/market-intelligence";

const envelopeSchema = z.object({
  status: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    action: z.object({
      sources: z.array(z.object({
        url: z.string(),
        title: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough().optional(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
      annotations: z.array(z.object({
        type: z.string(),
        url: z.string().optional(),
        title: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

function errorForStatus(status: number) {
  if (status === 401 || status === 403) return new MarketIntelligenceProviderError("authentication-failed");
  if (status === 429) return new MarketIntelligenceProviderError("rate-limited");
  return new MarketIntelligenceProviderError("service-unavailable");
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function parseResponse(payload: unknown, expectedWindow: { startDate: string; endDate: string }) {
  const envelope = envelopeSchema.parse(payload);
  if (envelope.status && envelope.status !== "completed") {
    throw new MarketIntelligenceProviderError("invalid-response");
  }
  const sources = new Map<string, MarketIntelligenceSource>();
  for (const item of envelope.output) {
    for (const source of item.action?.sources ?? []) {
      sources.set(normalizeUrl(source.url), { title: source.title?.trim() || new URL(source.url).hostname, url: source.url });
    }
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url) {
          sources.set(normalizeUrl(annotation.url), {
            title: annotation.title?.trim() || new URL(annotation.url).hostname,
            url: annotation.url,
          });
        }
      }
    }
  }
  const outputText = envelope.output.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new MarketIntelligenceProviderError("invalid-response");
  const candidate = marketIntelligenceCandidateSchema.parse(JSON.parse(outputText));
  if (candidate.windowStart !== expectedWindow.startDate || candidate.windowEnd !== expectedWindow.endDate) {
    throw new MarketIntelligenceProviderError("invalid-response");
  }
  return {
    windowStart: candidate.windowStart,
    windowEnd: candidate.windowEnd,
    events: candidate.events
      .map(({ sourceUrls, ...event }) => ({
        ...event,
        sources: Array.from(
          [...new Set(sourceUrls.map(normalizeUrl))].reduce((verified, url) => {
            const source = sources.get(url);
            if (!source) throw new MarketIntelligenceProviderError("invalid-response");
            const organization = new URL(source.url).hostname.replace(/^www\./, "");
            if (!verified.has(organization)) verified.set(organization, source);
            return verified;
          }, new Map<string, MarketIntelligenceSource>()).values(),
        ),
      }))
      .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title)),
  };
}

export class OpenAIMarketIntelligenceProvider implements MarketIntelligenceProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(input: { apiKey: string; model: string; fetch?: typeof globalThis.fetch }) {
    if (!input.apiKey.trim()) throw new MarketIntelligenceProviderError("authentication-failed");
    this.apiKey = input.apiKey;
    this.model = input.model;
    this.fetch = input.fetch ?? globalThis.fetch;
  }

  async generate(input: Parameters<MarketIntelligenceProvider["generate"]>[0]) {
    const window = createMarketIntelligenceWindow(input.now);
    try {
      const response = await this.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          store: false,
          instructions: createMarketIntelligenceInstructions(input.language),
          input: `Current instant: ${input.now}. Find scheduled events from ${window.startDate} through ${window.endDate}, inclusive.`,
          tools: [{
            type: "web_search",
            external_web_access: true,
            filters: { allowed_domains: marketIntelligenceOfficialDomains },
          }],
          tool_choice: "required",
          max_tool_calls: 4,
          include: ["web_search_call.action.sources"],
          text: { format: { type: "json_schema", name: "market_intelligence", strict: true, schema: marketIntelligenceJsonSchema } },
        }),
        signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(45_000)])
          : AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw errorForStatus(response.status);
      return parseResponse(await response.json(), window);
    } catch (error) {
      if (error instanceof MarketIntelligenceProviderError) throw error;
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new MarketIntelligenceProviderError("timeout");
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) {
        throw new MarketIntelligenceProviderError("invalid-response");
      }
      throw new MarketIntelligenceProviderError("service-unavailable");
    }
  }
}
