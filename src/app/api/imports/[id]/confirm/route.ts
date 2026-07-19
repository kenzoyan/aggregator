import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import {
  assetTypeSchema,
  currencyCodeSchema,
  decimalStringSchema,
  positiveDecimalStringSchema,
} from "@/domain/portfolio/schemas";
import { getPortfolioRepository } from "@/server/portfolio-db";

export const runtime = "nodejs";

const moneySchema = z.object({ amount: decimalStringSchema, currency: currencyCodeSchema });
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
        displayName: z.string().trim().min(1).optional(),
        instrumentCode: z.string().trim().min(1).optional(),
        assetType: assetTypeSchema.optional(),
        quantity: positiveDecimalStringSchema,
        currency: currencyCodeSchema,
        costBasis: decimalStringSchema,
        reportedPriorReturn: decimalStringSchema.optional(),
        averageCost: positiveDecimalStringSchema.optional(),
        observedPrice: positiveDecimalStringSchema.optional(),
        priceAsOf: z.iso.datetime().optional(),
        priceSource: z.string().trim().min(1).optional(),
        reportedMarketValue: positiveDecimalStringSchema.optional(),
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
  snapshot.positions.forEach((position, index) => {
    if (position.reportedMarketValue) {
      const accountedValue = new Decimal(position.costBasis).plus(position.reportedPriorReturn ?? "0");
      if (accountedValue.minus(position.reportedMarketValue).abs().gt("0.02")) {
        context.addIssue({
          code: "custom",
          path: ["proposedOpeningSnapshot", "positions", index, "reportedMarketValue"],
          message: "Current value must match cost basis plus prior return.",
        });
      }
    }
    if (position.reportedMarketValue && position.observedPrice) {
      const pricedValue = new Decimal(position.quantity).mul(position.observedPrice);
      if (pricedValue.minus(position.reportedMarketValue).abs().gt("0.02")) {
        context.addIssue({
          code: "custom",
          path: ["proposedOpeningSnapshot", "positions", index, "observedPrice"],
          message: "Quantity multiplied by price must match current value.",
        });
      }
    }
  });
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
