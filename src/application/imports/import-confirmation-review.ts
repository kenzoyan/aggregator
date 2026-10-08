import Decimal from "decimal.js";
import { z } from "zod";

import { importReductionReviewSchema } from "@/application/portfolio-cash-contract";

import type { StoredImportDraft } from "@/domain/imports";
import {
  assetTypeSchema,
  currencyCodeSchema,
  decimalStringSchema,
  positiveDecimalStringSchema,
} from "@/domain/portfolio/schemas";

const moneySchema = z.object({ amount: decimalStringSchema, currency: currencyCodeSchema });
const reviewSchema = z.object({
  confidence: z.string(),
  warnings: z.array(z.string()),
  portfolio: z.object({
    reductionReviews: z.array(importReductionReviewSchema).max(100).optional(),
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

type ImportConfirmationReview = z.infer<typeof reviewSchema>;

export function parseImportConfirmationReview(input: unknown): ImportConfirmationReview {
  return reviewSchema.parse(input);
}

export function validateImportConfirmationReview(
  existing: StoredImportDraft,
  review: ImportConfirmationReview,
): ImportConfirmationReview {
  const trackedTrading212Lines = new Set(
    existing.sourceKind === "trading-212"
      ? existing.portfolio.reconciliation?.holdings.flatMap((holding) =>
          holding.before && holding.proposedLineId
            ? [holding.proposedLineId]
            : []
        ) ?? []
      : [],
  );
  return reviewSchema.superRefine((candidate, context) => {
    candidate.portfolio.holdings.forEach((position, index) => {
      if (
        existing.sourceKind === "screenshot" &&
        position.observedPrice &&
        !position.priceAsOf
      ) {
        context.addIssue({
          code: "custom",
          path: ["portfolio", "holdings", index, "priceAsOf"],
          message: "Choose the NAV / price date, including year, before confirming this screenshot holding.",
        });
      }
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
  }).parse(review);
}
