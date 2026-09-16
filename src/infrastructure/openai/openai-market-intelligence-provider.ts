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
import {
  requestStructuredResponse,
  StructuredResponseError,
} from "@/infrastructure/responses/structured-response-client";

const sourceEnvelopeSchema = z.object({
  output: z.array(z.object({
    action: z.object({
      sources: z.array(z.object({
        url: z.string(),
        title: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough().optional(),
    content: z.array(z.object({
      annotations: z.array(z.object({
        type: z.string(),
        url: z.string().optional(),
        title: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    throw new StructuredResponseError("invalid-response");
  }
}

function parseResponse(
  payload: unknown,
  responseEnvelope: unknown,
  expectedWindow: { startDate: string; endDate: string },
) {
  const envelope = sourceEnvelopeSchema.parse(responseEnvelope);
  const sources = new Map<string, MarketIntelligenceSource>();
  for (const item of envelope.output) {
    const returnedSources = [
      ...(item.action?.sources ?? []),
      ...(item.content ?? [])
        .flatMap((content) => content.annotations ?? [])
        .filter((annotation) => annotation.type === "url_citation" && annotation.url)
        .map((annotation) => ({
          url: annotation.url as string,
          title: annotation.title,
        })),
    ];
    for (const source of returnedSources) {
      const normalizedUrl = normalizeUrl(source.url);
      sources.set(normalizedUrl, {
        title: source.title?.trim() || new URL(normalizedUrl).hostname,
        url: source.url,
      });
    }
  }
  const candidate = marketIntelligenceCandidateSchema.parse(payload);
  if (candidate.windowStart !== expectedWindow.startDate || candidate.windowEnd !== expectedWindow.endDate) {
    throw new StructuredResponseError("invalid-response");
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
            if (!source) throw new StructuredResponseError("invalid-response");
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
      return await requestStructuredResponse({
        endpoint: "https://api.openai.com/v1/responses",
        apiKey: this.apiKey,
        model: this.model,
        store: false,
        timeoutMs: 45_000,
        instructions: createMarketIntelligenceInstructions(input.language),
        prompt: `Current instant: ${input.now}. Find scheduled events from ${window.startDate} through ${window.endDate}, inclusive.`,
        tools: [{
          type: "web_search",
          external_web_access: true,
          filters: { allowed_domains: marketIntelligenceOfficialDomains },
        }],
        toolChoice: "required",
        maxToolCalls: 4,
        include: ["web_search_call.action.sources"],
        schemaName: "market_intelligence",
        jsonSchema: marketIntelligenceJsonSchema,
        signal: input.signal,
        parse: (payload, responseEnvelope) => parseResponse(payload, responseEnvelope, window),
        fetch: this.fetch,
      });
    } catch (error) {
      if (error instanceof MarketIntelligenceProviderError) throw error;
      if (error instanceof StructuredResponseError) {
        throw new MarketIntelligenceProviderError(error.code);
      }
      throw new MarketIntelligenceProviderError("service-unavailable");
    }
  }
}
