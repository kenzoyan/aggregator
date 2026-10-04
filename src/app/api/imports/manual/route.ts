import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import { createManualImportDraft } from "@/application/imports/manual-import";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";

const requestSchema = z.object({ sourceAccountId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const { sourceAccountId } = requestSchema.parse(await request.json());
    const database = getPortfolioDatabase();
    if (!database.readSourceAccounts().some((account) => account.id === sourceAccountId)) {
      return NextResponse.json({ error: "Choose a known source account." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const draft = createManualImportDraft({
      draftId: randomUUID(),
      snapshotId: randomUUID(),
      sourceAccountId,
      createdAt: now,
    });
    database.saveImportDraft(draft);
    return NextResponse.json({
      outcome: "review-required",
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
