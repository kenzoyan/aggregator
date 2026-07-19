import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { findSourceAccount, trading212SourceAccountId } from "@/domain/source-accounts";
import { Trading212Client } from "@/infrastructure/trading212/trading212-client";
import { getPortfolioRepository } from "@/server/portfolio-db";
import { getTrading212ConnectionConfig } from "@/server/trading212-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { sourceAccountId?: string };
  const sourceAccountId = body.sourceAccountId ?? trading212SourceAccountId;
  if (findSourceAccount(sourceAccountId)?.provider !== "trading212") {
    return NextResponse.json({ error: "Choose a Trading 212 source account." }, { status: 400 });
  }
  const config = getTrading212ConnectionConfig(sourceAccountId);
  if (!config) {
    return NextResponse.json(
      { error: "A read-only API key is not configured for this Trading 212 account." },
      { status: 503 },
    );
  }

  try {
    const client = new Trading212Client({
      ...config,
    });
    const id = randomUUID();
    const snapshot = await client.fetchOpeningSnapshot({
      id: randomUUID(),
      sourceAccountId,
    });
    const draft = {
      id,
      sourceAccountId,
      sourceKind: "trading-212" as const,
      createdAt: snapshot.asOf,
      confidence: "high",
      warnings: [
        `Trading 212 ${config.environment} account; only the account summary and positions GET endpoints are used.`,
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
