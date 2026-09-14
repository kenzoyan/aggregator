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
  type StructuredResponseMetadata,
} from "@/infrastructure/responses/structured-response-client";

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function parseResponse(
  payload: unknown,
  metadata: StructuredResponseMetadata,
  expectedWindow: { startDate: string; endDate: string },
) {
  const sources = new Map<string, MarketIntelligenceSource>();
  for (const source of metadata.sources) {
    sources.set(normalizeUrl(source.url), {
      title: source.title?.trim() || new URL(source.url).hostname,
      url: source.url,
    });
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
        reasoningEffort: "none",
        maxOutputTokens: 4_000,
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
        parse: (payload, metadata) => parseResponse(payload, metadata, window),
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
