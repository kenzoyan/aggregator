import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { trading212SourceAccountId } from "@/domain/source-accounts";
import { Trading212Client } from "@/infrastructure/trading212/trading212-client";
import { getPortfolioRepository } from "@/server/portfolio-db";

export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.TRADING212_API_KEY;
  const apiSecret = process.env.TRADING212_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "A Trading 212 read-only API key is not configured on this device." },
      { status: 503 },
    );
  }

  try {
    const environment = process.env.TRADING212_ENVIRONMENT === "live"
      ? "live"
      : "demo";
    const client = new Trading212Client({
      apiKey,
      apiSecret,
      environment,
    });
    const id = randomUUID();
    const snapshot = await client.fetchOpeningSnapshot({
      id: randomUUID(),
      sourceAccountId: trading212SourceAccountId,
    });
    const draft = {
      id,
      sourceAccountId: trading212SourceAccountId,
      sourceKind: "trading-212" as const,
      createdAt: snapshot.asOf,
      confidence: "high",
      warnings: [
        `Trading 212 ${environment} account; only the account summary and positions GET endpoints are used.`,
      ],
      proposedOpeningSnapshot: snapshot,
    };
    const repository = getPortfolioRepository();
    repository.createImportDraft(draft);
    return NextResponse.json({ draft: repository.getImportDraft(id) });
  } catch (error) {
    console.error("Trading 212 synchronization failed", error);
    return NextResponse.json(
      { error: "Trading 212 sync failed. Check read-only permissions, environment and IP restrictions." },
      { status: 502 },
    );
  }
}
