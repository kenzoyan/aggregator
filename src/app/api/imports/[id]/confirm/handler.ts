import { ImportReductionError } from "@/application/imports/import-reductions";
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  parseImportConfirmationReview,
  validateImportConfirmationReview,
} from "@/application/imports/import-confirmation-review";
import {
  applyImportDraftReview,
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { replyToImportConfirmation } from "@/server/portfolio-import-workflow";

type ImportConfirmDatabase = Pick<
  PortfolioDatabase,
  "getImportDraft" | "confirmImport"
> & Partial<Pick<PortfolioDatabase, "readPortfolioFacts">>;

export function createImportConfirmHandler(input: {
  database: ImportConfirmDatabase;
  newId: () => string;
  now: () => string;
}) {
  return async function handleImportConfirm(request: Request, id: string) {
    try {
      const existing = input.database.getImportDraft(id);

      if (!existing) {
        return NextResponse.json({ error: "Import draft not found." }, { status: 404 });
      }
      if (existing.sourceKind === "demo") {
        return NextResponse.json({ error: "Legacy demo drafts can no longer be confirmed." }, { status: 410 });
      }
      const shapedReview = parseImportConfirmationReview(await request.json());
      const editableReview = validateImportConfirmationReview(existing, shapedReview);
      const latestAccountSnapshot = input.database.readPortfolioFacts?.().openingSnapshots
        .filter((snapshot) => snapshot.sourceAccountId === existing.sourceAccountId)
        .toSorted((left, right) => right.asOf.localeCompare(left.asOf))[0];
      const reviewedDate = editableReview.portfolio.asOf.slice(0, 10);
      const latestDate = latestAccountSnapshot?.asOf.slice(0, 10);
      if (
        latestDate &&
        reviewedDate < latestDate
      ) {
        return NextResponse.json({
          error: `Valuation date must be ${latestDate} or later because this account already has newer confirmed holdings.`,
          fieldErrors: {
            "portfolio.asOf": `Choose ${latestDate} or a later date.`,
          },
        }, { status: 409 });
      }
      const review = applyImportDraftReview(existing, editableReview);
      const confirmed = input.database.confirmImport({
        draftId: id,
        confirmedImportId: input.newId(),
        confirmedAt: input.now(),
        review,
      });

      return NextResponse.json({
        draft: createImportDraftReadModel(confirmed),
      });
    } catch (error) {
      if (error instanceof ImportReductionError) {
        const current = input.database.getImportDraft(id);
        return NextResponse.json({ error: error.message, reconciliation: current?.portfolio.reconciliation }, { status: 409 });
      }
      if (error instanceof z.ZodError) {
        const fieldErrors = Object.fromEntries(
          error.issues.map((issue) => [issue.path.join("."), issue.message]),
        );
        return NextResponse.json(
          {
            error: error.issues[0]?.message ?? "Review the import values.",
            fieldErrors,
          },
          { status: 400 },
        );
      }
      console.error("Import confirmation failed", error);
      return NextResponse.json({ error: "Confirmation failed. Try again." }, { status: 500 });
    }
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const database = getPortfolioDatabase();
  const response = await createImportConfirmHandler({
    database,
    newId: randomUUID,
    now: () => new Date().toISOString(),
  })(request, id);
  const payload = await response.json();
  // Reply failure must never turn a completed import into a failed confirmation.
  let reply: object = {};
  try { reply = await replyToImportConfirmation(database, id, request.signal, response.ok ? undefined : payload.error); }
  catch { /* The existing draft and confirmation result remain authoritative. */ }
  return NextResponse.json({ ...payload, ...reply }, { status: response.status, headers: { "cache-control": "no-store" } });
}
