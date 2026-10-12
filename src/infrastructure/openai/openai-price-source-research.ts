import type { PriceSourceResearch } from "@/application/agent-price-source-discovery";
import { OpenAIWebResearch } from "@/infrastructure/openai/openai-web-research";

// Dedicated, read-only research role. The query contains public instrument identity only.
export class OpenAIPriceSourceResearch implements PriceSourceResearch {
  private readonly research: OpenAIWebResearch;
  constructor(input: ConstructorParameters<typeof OpenAIWebResearch>[0]) {
    this.research = new OpenAIWebResearch({ ...input, purpose: "price-source" });
  }
  search(input: Parameters<PriceSourceResearch["search"]>[0]) {
    return this.research.search({
      query: JSON.stringify({ task: "Find public pages for daily fund unit NAV, its exact valuation date, currency and share class. Identify the exact ISIN. holdingLabel is a user-assigned local display name, not the official fund identity; a label difference alone is not an identity mismatch. Return evidence links, not executable code or investment advice.", isin: input.isin, holdingLabel: input.name, currency: input.currency }),
      language: input.language, signal: input.signal,
    });
  }
}
