import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createCsvImportDraft } from "@/application/imports/csv-import";
import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";

const maximumCsvBytes = 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const sourceAccountId = String(form.get("sourceAccountId") ?? "");
    const file = form.get("file");
    const database = getPortfolioDatabase();

    if (!database.readSourceAccounts().some((account) => account.id === sourceAccountId)) {
      return NextResponse.json({ error: "Choose a known source account." }, { status: 400 });
    }
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Choose a CSV holdings file." }, { status: 400 });
    }
    if (file.size > maximumCsvBytes) {
      return NextResponse.json({ error: "CSV files must be 1 MB or smaller." }, { status: 413 });
    }

    const now = new Date().toISOString();
    const draft = createCsvImportDraft({
      draftId: randomUUID(),
      snapshotId: randomUUID(),
      sourceAccountId,
      createdAt: now,
      csv: await file.text(),
    });
    database.saveImportDraft(draft);
    return NextResponse.json({
      draft: createImportDraftReadModel(database.getImportDraft(draft.id)!),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSV import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
