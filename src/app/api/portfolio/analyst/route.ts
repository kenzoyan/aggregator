import { NextResponse } from "next/server";
import { z } from "zod";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import {
  createPortfolioAnalystTools,
  PortfolioAnalystContextError,
  type AnalystEvidenceFact,
  type AnalystPortfolioReadModel,
  type PortfolioAnalystContextV1,
} from "@/application/portfolio-analyst-context";
import {
  portfolioAnalystProviderIds,
  PortfolioAnalystProviderError,
  type PortfolioAnalystReport,
} from "@/application/portfolio-analyst-provider";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import {
  getPortfolioAnalystProviderRegistry,
  type PortfolioAnalystProviderRegistry,
} from "@/server/portfolio-analyst-config";
import { readCurrentPortfolioOverview } from "@/server/current-portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 8 * 1024;
const commonRequest = {
  provider: z.enum(portfolioAnalystProviderIds),
  language: z.enum(["en", "zh-CN"]),
  includeHoldingNames: z.boolean(),
};
const requestSchema = z.discriminatedUnion("job", [
  z.object({
    ...commonRequest,
    job: z.literal("explain-period-drivers"),
    period: z.enum(["today", "week", "month"]),
  }).strict(),
  z.object({
    ...commonRequest,
    job: z.literal("diagnose-data-quality"),
  }).strict(),
]);

const providerNames = { openai: "OpenAI", deepseek: "DeepSeek" } as const;

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...init?.headers },
  });
}

function citedEvidence(
  context: PortfolioAnalystContextV1,
  answer: PortfolioAnalystAnswer,
): AnalystEvidenceFact[] {
  const keys = new Set([
    ...answer.answer.evidence,
    ...answer.claims.flatMap((claim) => claim.evidence),
    ...answer.limitations.map((limitation) => limitation.evidenceKey),
    ...(answer.proposedUpdate ? [answer.proposedUpdate.reasonEvidenceKey] : []),
  ]);
  return context.facts.filter((fact) => keys.has(fact.key));
}

export function createPortfolioAnalystHandlers(
  registry: PortfolioAnalystProviderRegistry,
  options: {
    readCurrentPortfolio: () => AnalystPortfolioReadModel | undefined;
    now?: () => string;
  },
) {
  return {
    async GET() {
      return json({
        defaultProvider: registry.defaultProvider,
        providers: portfolioAnalystProviderIds.map((id) => ({
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
            { error: "Analyst request is too large.", code: "request-too-large" },
            { status: 413 },
          );
        }
        body = requestSchema.parse(JSON.parse(text));
      } catch {
        return json(
          { error: "Analyst request is invalid.", code: "invalid-request" },
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
      const portfolio = options.readCurrentPortfolio();
      if (!portfolio) {
        return json(
          { error: "No current portfolio facts are available.", code: "portfolio-empty" },
          { status: 409 },
        );
      }

      let context: PortfolioAnalystContextV1;
      try {
        const tools = createPortfolioAnalystTools(portfolio);
        context = body.job === "explain-period-drivers"
          ? tools.readPeriodDrivers({
              period: body.period,
              language: body.language,
              includeHoldingNames: body.includeHoldingNames,
            })
          : tools.readDataQuality({
              language: body.language,
              includeHoldingNames: body.includeHoldingNames,
            });
      } catch (error) {
        if (error instanceof PortfolioAnalystContextError) {
          return json(
            { error: "Analyst context is too large.", code: "context-too-large" },
            { status: 422 },
          );
        }
        throw error;
      }

      let answer: PortfolioAnalystAnswer;
      try {
        answer = await provider.generate(context);
      } catch (error) {
        const code = error instanceof PortfolioAnalystProviderError
          ? error.code
          : "provider-unavailable";
        const message = error instanceof PortfolioAnalystProviderError
          ? error.message
          : `${providerNames[body.provider]} could not generate a portfolio analyst answer.`;
        return json({ error: message, code }, { status: 502 });
      }

      const result: PortfolioAnalystReport = {
          provider: provider.id,
          model: provider.model,
          generatedAt: options.now?.() ?? new Date().toISOString(),
          contextVersion: context.version,
          job: context.job,
          language: context.language,
          scope: context.scope,
          factsAsOf: context.factsAsOf,
          answer,
          evidence: citedEvidence(context, answer),
          disclaimer: "AI-generated factual explanation · Not investment advice",
      };
      return json({ result });
    },
  };
}

let productionHandlers: ReturnType<typeof createPortfolioAnalystHandlers> | undefined;

function getProductionHandlers() {
  if (!productionHandlers) {
    const database = getPortfolioDatabase();
    productionHandlers = createPortfolioAnalystHandlers(
      getPortfolioAnalystProviderRegistry(),
      {
        readCurrentPortfolio: () => readCurrentPortfolioOverview(
          database,
          new Date().toISOString(),
        ),
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
