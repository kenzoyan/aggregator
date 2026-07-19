import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import { getPortfolioRepository } from "@/server/portfolio-db";

export const runtime = "nodejs";

const decimalSchema = z.string().trim().refine(
  (value) => {
    try {
      return new Decimal(value).isFinite();
    } catch {
      return false;
    }
  },
  "Enter a valid number.",
);
const positiveDecimalSchema = decimalSchema.refine(
  (value) => new Decimal(value).gt(0),
  "Quantity must be greater than zero.",
);
const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code.");
const moneySchema = z.object({ amount: decimalSchema, currency: currencySchema });
const reviewSchema = z.object({
  confidence: z.string(),
  warnings: z.array(z.string()),
  proposedOpeningSnapshot: z.object({
    id: z.string(),
    sourceAccountId: z.string(),
    asOf: z.iso.datetime(),
    portfolioCash: moneySchema.optional(),
    positions: z.array(
      z.object({
        instrumentId: z.string().min(1),
        quantity: positiveDecimalSchema,
        currency: currencySchema,
        costBasis: decimalSchema,
        reportedPriorReturn: decimalSchema.optional(),
      }),
    ),
  }),
}).superRefine((review, context) => {
  const snapshot = review.proposedOpeningSnapshot;
  if (snapshot.positions.length === 0 && !snapshot.portfolioCash) {
    context.addIssue({
      code: "custom",
      path: ["proposedOpeningSnapshot", "positions"],
      message: "Add at least one holding or a portfolio cash balance.",
    });
  }
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
