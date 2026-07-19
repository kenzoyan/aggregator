import { NextResponse } from "next/server";
import { z } from "zod";

import { getPortfolioRepository } from "@/server/portfolio-db";

export const runtime = "nodejs";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const reviewSchema = z.object({
  confidence: z.string(),
  warnings: z.array(z.string()),
  proposedOpeningSnapshot: z.object({
    id: z.string(),
    sourceAccountId: z.string(),
    asOf: z.string(),
    portfolioCash: moneySchema.optional(),
    positions: z.array(
      z.object({
        instrumentId: z.string().min(1),
        quantity: z.string().min(1),
        currency: z.string().min(1),
        costBasis: z.string().min(1),
        reportedPriorReturn: z.string().optional(),
      }),
    ),
  }),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const review = reviewSchema.parse(await request.json());
    const repository = getPortfolioRepository();
    const existing = repository.getImportDraft(id);

    if (!existing) {
      return NextResponse.json({ error: "Import draft not found." }, { status: 404 });
    }
    if (existing.sourceAccountId !== review.proposedOpeningSnapshot.sourceAccountId) {
      return NextResponse.json(
        { error: "The source account cannot be changed during confirmation." },
        { status: 400 },
      );
    }

    if (existing.status === "draft") {
      repository.updateImportDraft(id, review);
      repository.confirmImportDraft(id, new Date().toISOString());
    }

    return NextResponse.json({ draft: repository.getImportDraft(id) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Check the name, quantity, currency, cost basis and prior return." },
        { status: 400 },
      );
    }
    console.error("Import confirmation failed", error);
    return NextResponse.json({ error: "Confirmation failed. Try again." }, { status: 500 });
  }
}
