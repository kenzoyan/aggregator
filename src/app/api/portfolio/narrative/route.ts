import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  createPortfolioNarrativeFacts,
  createPortfolioNarrativeFingerprint,
} from "@/application/portfolio-narrative-facts";
import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import {
  narrativeProviderIds,
  PortfolioNarrativeProviderError,
  type PortfolioNarrativeContent,
  type PortfolioNarrativeReport,
} from "@/application/portfolio-narrative";
import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";
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
  registry: PortfolioNarrativeProviderRegistry,
  options: {
    database: Pick<
      PortfolioDatabase,
      "savePortfolioNarrative" | "readLatestPortfolioNarrative"
    >;
    now?: () => string;
    createId?: () => string;
    readCurrentInsights: () => PortfolioInsightsReadModel | undefined;
  },
) {
  return {
    async GET() {
      const latestNarrative = options.database.readLatestPortfolioNarrative();
      return json({
        defaultProvider: registry.defaultProvider,
        providers: narrativeProviderIds.map((id) => ({
          id,
          configured: Boolean(registry.providers[id]),
          model: registry.models[id],
        })),
        ...(latestNarrative ? { latestNarrative } : {}),
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
      const insights = options.readCurrentInsights();
      if (!insights) {
        return json(
          { error: "No current portfolio facts are available.", code: "portfolio-empty" },
          { status: 409 },
        );
      }

      let content: PortfolioNarrativeContent;
      try {
        content = await provider.generate({
          insights,
          language: body.language,
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

      const evidenceKeys = new Set([
        ...content.headline.evidence,
        ...content.overview.evidence,
        ...content.observations.flatMap((observation) => observation.evidence),
        ...content.dataQuality.evidence,
      ]);
      const narrative: PortfolioNarrativeReport = {
        id: options.createId?.() ?? randomUUID(),
        provider: provider.id,
        model: provider.model,
        language: body.language,
        generatedAt: options.now?.() ?? new Date().toISOString(),
        portfolioAsOf: insights.asOf,
        factsFingerprint: createPortfolioNarrativeFingerprint(insights),
        ...content,
        provenance: createPortfolioNarrativeFacts(insights).filter((fact) =>
          evidenceKeys.has(fact.key)
        ),
        disclaimer: "AI-generated factual summary · Not investment advice",
      };
      try {
        options.database.savePortfolioNarrative(narrative);
      } catch {
        return json(
          {
            error: "The narrative was generated but could not be saved locally.",
            code: "narrative-storage-failed",
          },
          { status: 500 },
        );
      }
      return json({ narrative });
    },
  };
}

let productionHandlers: ReturnType<typeof createPortfolioNarrativeHandlers> | undefined;

function getProductionHandlers() {
  if (!productionHandlers) {
    const database = getPortfolioDatabase();
    productionHandlers = createPortfolioNarrativeHandlers(
      getPortfolioNarrativeProviderRegistry(),
      {
        database,
        readCurrentInsights: () => {
          const facts = database.readPortfolioFacts();
          if (facts.state.positions.length === 0 && facts.state.cashBalances.length === 0) {
            return undefined;
          }
          const marketData = database.readMarketData();
          return createPortfolioOverviewReadModel({
            snapshots: facts.openingSnapshots,
            events: facts.events,
            marketPrices: marketData.observations,
            fxObservations: marketData.fxObservations,
            latestMarketRefresh: marketData.latestMarketRefresh,
            accountLabels: database.readSourceAccountLabels(),
            asOf: new Date().toISOString(),
          }).insights;
        },
      },
    );
  }
  return productionHandlers;
}

export async function GET() {
  return getProductionHandlers().GET();
}

export async function POST(request: Request) {
  return getProductionHandlers().POST(request);
}
