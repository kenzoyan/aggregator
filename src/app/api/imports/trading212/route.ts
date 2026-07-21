import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import {
  draftPortfolioFromOpeningSnapshot,
  type ImportDraftInput,
  type StoredImportDraft,
} from "@/domain/imports";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";
import { findSourceAccount, trading212SourceAccountId } from "@/domain/source-accounts";
import {
  Trading212Client,
  Trading212RequestError,
} from "@/infrastructure/trading212/trading212-client";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import {
  getTrading212ConnectionConfig,
  type Trading212ConnectionConfig,
} from "@/server/trading212-config";

export const runtime = "nodejs";

interface Trading212ImportDatabase {
  saveImportDraft(draft: ImportDraftInput): void;
  getImportDraft(id: string): StoredImportDraft | undefined;
}

interface Trading212SnapshotClient {
  fetchOpeningSnapshot(input: {
    id: string;
    sourceAccountId: string;
  }): Promise<OpeningSnapshotInput>;
}

export function createTrading212ImportHandler(input: {
  database: Trading212ImportDatabase;
  getConfig: (sourceAccountId: string) => Trading212ConnectionConfig | undefined;
  createClient: (config: Trading212ConnectionConfig) => Trading212SnapshotClient;
  newId: () => string;
  logError?: (message: string, error: unknown) => void;
}) {
  return async function handleTrading212Import(request: Request) {
    const body = await request.json().catch(() => ({})) as { sourceAccountId?: string };
    const sourceAccountId = body.sourceAccountId ?? trading212SourceAccountId;
    if (findSourceAccount(sourceAccountId)?.provider !== "trading212") {
      return NextResponse.json({ error: "Choose a Trading 212 source account." }, { status: 400 });
    }
    const config = input.getConfig(sourceAccountId);
    if (!config) {
      return NextResponse.json(
        { error: "A read-only API key is not configured for this Trading 212 account." },
        { status: 503 },
      );
    }

    try {
      const client = input.createClient(config);
      const id = input.newId();
      const snapshot = await client.fetchOpeningSnapshot({
        id: input.newId(),
        sourceAccountId,
      });
      const draft: ImportDraftInput = {
        id,
        sourceAccountId,
        sourceKind: "trading-212",
        createdAt: snapshot.asOf,
        confidence: "high",
        warnings: [
          `Trading 212 ${config.environment} account; only the account summary and positions GET endpoints are used.`,
        ],
        portfolio: draftPortfolioFromOpeningSnapshot(snapshot, "api"),
      };
      input.database.saveImportDraft(draft);
      return NextResponse.json({
        draft: createImportDraftReadModel(input.database.getImportDraft(id)!),
      });
    } catch (error) {
      (input.logError ?? console.error)("Trading 212 synchronization failed", error);
      if (error instanceof Trading212RequestError && [401, 403].includes(error.status)) {
        return NextResponse.json(
          { error: "Trading 212 rejected the credentials. Check the key and secret, read-only account/portfolio permissions, environment and IP restrictions." },
          { status: 502 },
        );
      }
      if (error instanceof Trading212RequestError && error.status === 429) {
        return NextResponse.json(
          { error: `Trading 212 rate limit reached. Retry${error.retryAfter ? ` after ${error.retryAfter} seconds` : " shortly"}.` },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { error: "Trading 212 sync failed. Check read-only permissions, environment and IP restrictions." },
        { status: 502 },
      );
    }
  };
}

export async function POST(request: Request) {
  return createTrading212ImportHandler({
    database: getPortfolioDatabase(),
    getConfig: getTrading212ConnectionConfig,
    createClient: (config) => new Trading212Client(config),
    newId: randomUUID,
  })(request);
}
