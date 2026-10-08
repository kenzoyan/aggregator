import { NextResponse } from "next/server";
import { z } from "zod";

import { importReductionReviewSchema } from "@/application/portfolio-cash-contract";

import {
  applyImportDraftReview,
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import { assetTypeSchema } from "@/domain/portfolio/schemas";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";
import { getPortfolioDatabase } from "@/server/portfolio-db";

const short = z.string().max(200);
const holdingSchema = z.object({
  lineId: z.string().min(1).max(100),
  instrumentId: short,
  displayName: short.optional(),
  instrumentCode: short.optional(),
  assetType: assetTypeSchema.optional(),
  quantity: short,
  currency: z.string().max(3),
  costBasis: short,
  reportedPriorReturn: short.optional(),
  averageCost: short.optional(),
  observedPrice: short.optional(),
  priceAsOf: short.optional(),
  priceSource: short.optional(),
  reportedMarketValue: short.optional(),
}).strict();
const draftReviewSchema = z.object({
  confidence: short,
  warnings: z.array(z.string().max(1000)).max(50),
  portfolio: z.object({
    reductionReviews: z.array(importReductionReviewSchema).max(100).optional(),
    snapshotId: z.string().min(1).max(100),
    asOf: short,
    portfolioCash: z.object({ amount: short, currency: z.string().max(3) }).strict().optional(),
    holdings: z.array(holdingSchema).max(100),
  }).strict(),
}).strict();

type ReviewDatabase = Pick<PortfolioDatabase, "getImportDraft" | "saveImportDraftReview">;

export function createImportDraftReviewHandler(database: ReviewDatabase) {
  return async (request: Request, id: string) => {
    let body: z.infer<typeof draftReviewSchema>;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
        return NextResponse.json({ error: "Draft review is too large." }, { status: 413 });
      }
      body = draftReviewSchema.parse(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: "Draft review is invalid." }, { status: 400 });
    }
    const existing = database.getImportDraft(id);
    if (!existing) return NextResponse.json({ error: "Import draft not found." }, { status: 404 });
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "This import is already confirmed." }, { status: 409 });
    }
    if (body.portfolio.snapshotId !== existing.portfolio.snapshotId) {
      return NextResponse.json({ error: "Snapshot identity cannot be changed." }, { status: 400 });
    }
    const ids = body.portfolio.holdings.map((holding) => holding.lineId);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "Holding identities must be unique." }, { status: 400 });
    }
    try {
      const review = applyImportDraftReview(existing, body);
      const saved = database.saveImportDraftReview(id, review);
      return NextResponse.json({ draft: createImportDraftReadModel(saved) });
    } catch {
      return NextResponse.json({ error: "Draft could not be saved." }, { status: 409 });
    }
  };
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createImportDraftReviewHandler(getPortfolioDatabase())(request, id);
}
