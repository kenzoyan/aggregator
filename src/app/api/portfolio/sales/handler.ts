import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareSaleReview, saleInputSchema, SaleReviewError } from "@/application/portfolio-sale";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";

type SaleDatabase = Pick<PortfolioDatabase, "readPortfolioFacts" | "confirmSale">;
const confirmationSchema = z.object({
  sale: saleInputSchema,
  reviewToken: z.string().length(64),
  confirm: z.literal(true),
}).strict();

export function createSaleHandlers(database: SaleDatabase, createId: () => string = randomUUID) {
  return {
    async POST(request: Request) {
      try {
        const sale = saleInputSchema.parse(await request.json());
        const review = prepareSaleReview(database.readPortfolioFacts(), sale);
        return NextResponse.json({ preview: review.preview, reviewToken: review.reviewToken });
      } catch (error) {
        return saleErrorResponse(error);
      }
    },
    async PUT(request: Request) {
      try {
        const confirmation = confirmationSchema.parse(await request.json());
        const event = database.confirmSale(
          confirmation.sale, confirmation.reviewToken, createId(),
        );
        return NextResponse.json({ event }, { status: 201 });
      } catch (error) {
        return saleErrorResponse(error);
      }
    },
  };
}

function saleErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Review the sale values." }, { status: 400 });
  }
  if (error instanceof SaleReviewError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  console.error("Sale review failed", error);
  return NextResponse.json({ error: "Sale could not be reviewed or saved." }, { status: 500 });
}

export async function POST(request: Request) {
  return createSaleHandlers(getPortfolioDatabase()).POST(request);
}

export async function PUT(request: Request) {
  return createSaleHandlers(getPortfolioDatabase()).PUT(request);
}
