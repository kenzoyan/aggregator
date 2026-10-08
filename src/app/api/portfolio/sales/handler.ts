import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createCashActivityReadModel, prepareWithdrawalReview, withdrawalInputSchema } from "@/application/portfolio-cash-activity";
import { prepareSaleReview, saleInputSchema, SaleReviewError } from "@/application/portfolio-sale";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";

type SaleDatabase = Pick<PortfolioDatabase, "readPortfolioFacts" | "confirmSale" | "confirmWithdrawal" | "undoCashActivity">;
const confirmationSchema = z.object({
  sale: saleInputSchema,
  reviewToken: z.string().length(64),
  confirm: z.literal(true),
}).strict();

export function createSaleHandlers(database: SaleDatabase, createId: () => string = randomUUID) {
  return {
    async GET(request: Request) {
      const sourceAccountId = new URL(request.url).searchParams.get("sourceAccountId");
      if (!sourceAccountId || sourceAccountId.length > 200) return NextResponse.json({ error: "Choose an account." }, { status: 400 });
      return NextResponse.json(createCashActivityReadModel(database.readPortfolioFacts(), sourceAccountId));
    },
    async DELETE(request: Request) {
      try {
        const input = z.object({ id: z.string().min(1), reviewToken: z.string().length(64), confirm: z.literal(true) }).strict().parse(await request.json());
        return NextResponse.json({ event: database.undoCashActivity(input.id, input.reviewToken) });
      } catch (error) { return saleErrorResponse(error); }
    },
    async POST(request: Request) {
      try {
        const body = await request.json();
        if (body?.type === "cash-withdrawal") {
          const { type: _type, ...input } = body;
          return NextResponse.json(prepareWithdrawalReview(database.readPortfolioFacts(), withdrawalInputSchema.parse(input)));
        }
        const sale = saleInputSchema.parse(body);
        const review = prepareSaleReview(database.readPortfolioFacts(), sale);
        return NextResponse.json({ preview: review.preview, reviewToken: review.reviewToken });
      } catch (error) {
        return saleErrorResponse(error);
      }
    },
    async PUT(request: Request) {
      try {
        const body = await request.json();
        if (body?.type === "cash-withdrawal") {
          const confirmation = z.object({ type: z.literal("cash-withdrawal"), withdrawal: withdrawalInputSchema, reviewToken: z.string().length(64), confirm: z.literal(true) }).strict().parse(body);
          return NextResponse.json({ event: database.confirmWithdrawal(confirmation.withdrawal, confirmation.reviewToken, createId()) }, { status: 201 });
        }
        const confirmation = confirmationSchema.parse(body);
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
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Sale or transfer input is invalid." }, { status: 400 });
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

export async function GET(request: Request) { return createSaleHandlers(getPortfolioDatabase()).GET(request); }
export async function DELETE(request: Request) { return createSaleHandlers(getPortfolioDatabase()).DELETE(request); }
