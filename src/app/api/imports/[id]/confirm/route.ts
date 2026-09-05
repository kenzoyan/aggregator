import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import {
  applyImportDraftReview,
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import {
  materializeOpeningSnapshot,
  type StoredImportDraft,
} from "@/domain/imports";
import {
  assetTypeSchema,
  currencyCodeSchema,
  decimalStringSchema,
  positiveDecimalStringSchema,
} from "@/domain/portfolio/schemas";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";

const moneySchema = z.object({ amount: decimalStringSchema, currency: currencyCodeSchema });
const reviewSchema = z.object({
  confidence: z.string(),
  warnings: z.array(z.string()),
  portfolio: z.object({
    snapshotId: z.string().min(1),
    asOf: z.iso.datetime(),
    portfolioCash: moneySchema.optional(),
    holdings: z.array(
      z.object({
        lineId: z.string().min(1),
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
  const portfolio = review.portfolio;
  if (portfolio.holdings.length === 0 && !portfolio.portfolioCash) {
    context.addIssue({
      code: "custom",
      path: ["portfolio", "holdings"],
      message: "Add at least one holding or a portfolio cash balance.",
    });
  }
  portfolio.holdings.forEach((position, index) => {
    if (position.reportedMarketValue && position.observedPrice) {
      const pricedValue = new Decimal(position.quantity).mul(position.observedPrice);
      if (pricedValue.minus(position.reportedMarketValue).abs().gt("0.02")) {
        context.addIssue({
          code: "custom",
          path: ["portfolio", "holdings", index, "observedPrice"],
          message: `Quantity × price is ${pricedValue.toFixed(2)} ${position.currency}, but current value is ${new Decimal(position.reportedMarketValue).toFixed(2)} ${position.currency}.`,
        });
      }
    }
  });
});

function reviewSchemaFor(existing: StoredImportDraft) {
  const trackedTrading212Lines = new Set(
    existing.sourceKind === "trading-212"
      ? existing.portfolio.reconciliation?.holdings.flatMap((holding) =>
          holding.before && holding.proposedLineId
            ? [holding.proposedLineId]
            : []
        ) ?? []
      : [],
  );
  return reviewSchema.superRefine((review, context) => {
    review.portfolio.holdings.forEach((position, index) => {
      if (
        !position.reportedMarketValue ||
        trackedTrading212Lines.has(position.lineId)
      ) return;
      const accountedValue = new Decimal(position.costBasis)
        .plus(position.reportedPriorReturn ?? "0");
      if (accountedValue.minus(position.reportedMarketValue).abs().lte("0.02")) {
        return;
      }
      context.addIssue({
        code: "custom",
        path: ["portfolio", "holdings", index, "reportedMarketValue"],
        message: `Cost basis + prior return is ${accountedValue.toFixed(2)} ${position.currency}, but current value is ${new Decimal(position.reportedMarketValue).toFixed(2)} ${position.currency}.`,
      });
    });
  });
}

type ImportConfirmDatabase = Pick<
  PortfolioDatabase,
  "getImportDraft" | "confirmImport"
>;

export function createImportConfirmHandler(input: {
  database: ImportConfirmDatabase;
  newId: () => string;
  now: () => string;
}) {
  return async function handleImportConfirm(request: Request, id: string) {
    try {
      const shapedReview = reviewSchema.parse(await request.json());
      const existing = input.database.getImportDraft(id);

      if (!existing) {
        return NextResponse.json({ error: "Import draft not found." }, { status: 404 });
      }
      const editableReview = reviewSchemaFor(existing).parse(shapedReview);
      const review = applyImportDraftReview(existing, editableReview);
      const confirmed = input.database.confirmImport({
        draftId: id,
        confirmedImportId: input.newId(),
        confirmedAt: input.now(),
        review,
      });

      return NextResponse.json({
        draft: createImportDraftReadModel(confirmed),
        confirmedSnapshot: materializeOpeningSnapshot(
          confirmed.sourceAccountId,
          confirmed.portfolio,
        ),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = Object.fromEntries(
          error.issues.map((issue) => [issue.path.join("."), issue.message]),
        );
        return NextResponse.json(
          {
            error: error.issues[0]?.message ?? "Review the import values.",
            fieldErrors,
          },
          { status: 400 },
        );
      }
      console.error("Import confirmation failed", error);
      return NextResponse.json({ error: "Confirmation failed. Try again." }, { status: 500 });
    }
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return createImportConfirmHandler({
    database: getPortfolioDatabase(),
    newId: randomUUID,
    now: () => new Date().toISOString(),
  })(request, id);
}
