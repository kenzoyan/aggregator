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
import { materializeOpeningSnapshot } from "@/domain/imports";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioDatabase } from "@/server/portfolio-db";

type ImportConfirmDatabase = Pick<
  PortfolioDatabase,
  "getImportDraft" | "confirmImport"
>;

export function createImportConfirmHandler(input: {
  database: ImportConfirmDatabase;
  newId: () => string;
  now: () => string;
}) {
  return async function handleImportConfirm(request: Request, id: string) {
    try {
      const shapedReview = parseImportConfirmationReview(await request.json());
      const existing = input.database.getImportDraft(id);

      if (!existing) {
        return NextResponse.json({ error: "Import draft not found." }, { status: 404 });
      }
      const editableReview = validateImportConfirmationReview(existing, shapedReview);
      const review = applyImportDraftReview(existing, editableReview);
      const confirmed = input.database.confirmImport({
        draftId: id,
        confirmedImportId: input.newId(),
        confirmedAt: input.now(),
        review,
      });

      return NextResponse.json({
        draft: createImportDraftReadModel(confirmed),
        confirmedSnapshot: materializeOpeningSnapshot(
          confirmed.sourceAccountId,
          confirmed.portfolio,
        ),
      });
    } catch (error) {
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
  return createImportConfirmHandler({
    database: getPortfolioDatabase(),
    newId: randomUUID,
    now: () => new Date().toISOString(),
  })(request, id);
}
