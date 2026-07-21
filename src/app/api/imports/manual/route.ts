import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import { createManualImportDraft } from "@/application/imports/manual-import";
import { findSourceAccount } from "@/domain/source-accounts";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";

const requestSchema = z.object({ sourceAccountId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const { sourceAccountId } = requestSchema.parse(await request.json());
    if (!findSourceAccount(sourceAccountId)) {
      return NextResponse.json({ error: "Choose a known source account." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const draft = createManualImportDraft({
      draftId: randomUUID(),
      snapshotId: randomUUID(),
      sourceAccountId,
      createdAt: now,
    });
    const database = getPortfolioDatabase();
    database.saveImportDraft(draft);
    return NextResponse.json({
      draft: createImportDraftReadModel(database.getImportDraft(draft.id)!),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Choose a source account." }, { status: 400 });
    }
    console.error("Manual import draft failed", error);
    return NextResponse.json({ error: "Manual draft could not be created." }, { status: 500 });
  }
}
