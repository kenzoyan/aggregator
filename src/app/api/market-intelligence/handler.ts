import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  MarketIntelligenceProviderError,
  type MarketIntelligenceBrief,
} from "@/application/market-intelligence";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getMarketIntelligenceRegistry, type MarketIntelligenceRegistry } from "@/server/market-intelligence-config";
import { getPortfolioDatabase } from "@/server/portfolio-db";

const requestSchema = z.object({ language: z.enum(["en", "zh-CN"]) }).strict();

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "cache-control": "no-store", ...init?.headers } });
}

export function createMarketIntelligenceHandlers(
  registry: MarketIntelligenceRegistry,
  options: {
    database: Pick<PortfolioDatabase, "saveMarketIntelligenceBrief" | "readLatestMarketIntelligenceBrief">;
    now?: () => string;
    createId?: () => string;
  },
) {
  return {
    async GET() {
      const latestBrief = options.database.readLatestMarketIntelligenceBrief();
      return json({ configured: Boolean(registry.provider), model: registry.model, ...(latestBrief ? { latestBrief } : {}) });
    },
    async POST(request: Request) {
      let body: z.infer<typeof requestSchema>;
      try {
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > 1024) throw new Error("too large");
        body = requestSchema.parse(JSON.parse(text));
      } catch {
        return json({ error: "Market information request is invalid.", code: "invalid-request" }, { status: 400 });
      }
      if (!registry.provider) {
        return json({ error: "OpenAI is not configured. Add its API key to .env.local.", code: "provider-not-configured" }, { status: 503 });
      }
      const generatedAt = options.now?.() ?? new Date().toISOString();
      let content;
      try {
        content = await registry.provider.generate({ language: body.language, now: generatedAt, signal: request.signal });
      } catch (error) {
        const code = error instanceof MarketIntelligenceProviderError ? error.code : "service-unavailable";
        return json({ error: "Official market calendars could not be refreshed. The previous brief was kept.", code }, { status: 502 });
      }
      const brief: MarketIntelligenceBrief = {
        version: "market-intelligence.v1",
        id: options.createId?.() ?? randomUUID(),
        provider: "openai",
        model: registry.provider.model,
        language: body.language,
        generatedAt,
        disclaimer: "External market information · Not investment advice",
        ...content,
      };
      try {
        options.database.saveMarketIntelligenceBrief(brief);
      } catch {
        return json({ error: "Market information was refreshed but could not be saved locally.", code: "storage-failed" }, { status: 500 });
      }
      return json({ brief });
    },
  };
}

function getProductionHandlers() {
  return createMarketIntelligenceHandlers(
    getMarketIntelligenceRegistry(),
    { database: getPortfolioDatabase() },
  );
}

export function GET() { return getProductionHandlers().GET(); }
export function POST(request: Request) { return getProductionHandlers().POST(request); }
