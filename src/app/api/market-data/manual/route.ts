import { NextResponse } from "next/server";
import Decimal from "decimal.js";
import { z } from "zod";

import { portfolioCalendarDate } from "@/application/portfolio-calendar";
import type { MarketPriceObservation } from "@/domain/market-data";
import { positiveDecimalStringSchema } from "@/domain/portfolio/schemas";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  sourceAccountId: z.string().trim().min(1),
  instrumentId: z.string().trim().min(1),
  price: positiveDecimalStringSchema,
  asOf: z.iso.date(),
});

type ManualMarketPriceDatabase = Pick<
  PortfolioDatabase,
  "readPortfolioFacts" | "recordMarketData"
>;

export function createManualMarketPriceHandler(input: {
  database: ManualMarketPriceDatabase;
  now?: () => string;
}) {
  return async function handleManualMarketPrice(request: Request) {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Check the price and date." },
        { status: 400 },
      );
    }

    const now = input.now?.() ?? new Date().toISOString();
    if (parsed.data.asOf > portfolioCalendarDate(now)) {
      return NextResponse.json(
        { error: "Price date cannot be in the future." },
        { status: 400 },
      );
    }

    const position = input.database.readPortfolioFacts().state.positions.find(
      (candidate) =>
        candidate.sourceAccountId === parsed.data.sourceAccountId &&
        candidate.instrumentId === parsed.data.instrumentId,
    );
    if (!position) {
      return NextResponse.json(
        { error: "Holding was not found in this Source Account." },
        { status: 404 },
      );
    }

    const observation: MarketPriceObservation = {
      sourceAccountId: position.sourceAccountId,
      instrumentId: position.instrumentId,
      instrumentCode: position.instrumentCode ?? position.instrumentId,
      price: new Decimal(parsed.data.price).toString(),
      currency: position.currency,
      asOf: parsed.data.asOf,
      recordedAt: now,
      source: "manual",
    };
    input.database.recordMarketData({ observations: [observation] });
    return NextResponse.json({ observation });
  };
}

export async function POST(request: Request) {
  return createManualMarketPriceHandler({
    database: getPortfolioDatabase(),
  })(request);
}
