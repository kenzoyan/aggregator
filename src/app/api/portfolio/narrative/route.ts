import { NextResponse } from "next/server";
import { z } from "zod";

import {
  narrativeProviderIds,
  portfolioInsightsNarrativeInputSchema,
  PortfolioNarrativeProviderError,
} from "@/application/portfolio-narrative";
import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";
import {
  getPortfolioNarrativeProviderRegistry,
  type PortfolioNarrativeProviderRegistry,
} from "@/server/portfolio-narrative-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 32 * 1024;
const requestSchema = z.object({
  provider: z.enum(narrativeProviderIds),
  language: z.enum(["en", "zh-CN"]),
  insights: portfolioInsightsNarrativeInputSchema,
}).strict();

const providerNames = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
} as const;

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init?.headers,
    },
  });
}

export function createPortfolioNarrativeHandlers(
  registry: PortfolioNarrativeProviderRegistry & { now?: () => string },
) {
  return {
    async GET() {
      return json({
        defaultProvider: registry.defaultProvider,
        providers: narrativeProviderIds.map((id) => ({
          id,
          configured: Boolean(registry.providers[id]),
          model: registry.models[id],
        })),
      });
    },

    async POST(request: Request) {
      let body: z.infer<typeof requestSchema>;
      try {
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
          return json(
            { error: "Narrative request is too large", code: "request-too-large" },
            { status: 413 },
          );
        }
        body = requestSchema.parse(JSON.parse(text));
      } catch {
        return json(
          { error: "Narrative request is invalid", code: "invalid-request" },
          { status: 400 },
        );
      }

      const provider = registry.providers[body.provider];
      if (!provider) {
        return json({
          error: `${providerNames[body.provider]} is not configured. Add its API key to .env.local.`,
          code: "provider-not-configured",
        }, { status: 503 });
      }

      try {
        const content = await provider.generate({
          insights: body.insights as PortfolioInsightsReadModel,
          language: body.language,
        });
        return json({
          narrative: {
            provider: provider.id,
            model: provider.model,
            language: body.language,
            generatedAt: registry.now?.() ?? new Date().toISOString(),
            ...content,
            disclaimer: "AI-generated factual summary · Not investment advice",
          },
        });
      } catch (error) {
        const message = error instanceof PortfolioNarrativeProviderError
          ? error.message
          : `${providerNames[body.provider]} could not generate a portfolio narrative.`;
        return json(
          { error: message, code: "provider-unavailable" },
          { status: 502 },
        );
      }
    },
  };
}

const handlers = createPortfolioNarrativeHandlers(
  getPortfolioNarrativeProviderRegistry(),
);

export const GET = handlers.GET;
export const POST = handlers.POST;
