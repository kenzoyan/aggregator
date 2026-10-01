import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createImportDraftReviewHandler } from "@/app/api/imports/[id]/review/handler";
import {
  createImportDraftConfirmationPayload,
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import { draftPortfolioFromOpeningSnapshot } from "@/domain/imports";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("PUT /api/imports/:id/review", () => {
  it("persists incomplete edits without confirming or changing holdings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synthetic-import-review-"));
    const filename = join(directory, "portfolio.sqlite");
    try {
      const database = createPortfolioDatabase(filename);
      database.saveImportDraft({
        id: "synthetic-review",
        sourceAccountId: "synthetic-account",
        sourceKind: "screenshot",
        createdAt: "2026-09-22T10:00:00.000Z",
        confidence: "high",
        warnings: [],
        portfolio: draftPortfolioFromOpeningSnapshot({
          id: "synthetic-snapshot",
          sourceAccountId: "synthetic-account",
          asOf: "2026-09-22T00:00:00.000Z",
          positions: [{ instrumentId: "SYNTH-1", quantity: "2", currency: "CNY", costBasis: "100" }],
        }, "vision"),
      });
      const draft = createImportDraftReadModel(database.getImportDraft("synthetic-review")!);
      const review = createImportDraftConfirmationPayload(draft);
      review.portfolio.holdings[0]!.displayName = "Corrected synthetic fund";
      review.portfolio.holdings[0]!.quantity = "";
      const handler = createImportDraftReviewHandler(database);
      const response = await handler(new Request("http://localhost/api/imports/synthetic-review/review", {
        method: "PUT",
        body: JSON.stringify(review),
      }), "synthetic-review");

      expect(response.status).toBe(200);
      expect(createImportDraftReadModel(database.getImportDraft("synthetic-review")!).portfolio.holdings[0]).toMatchObject({
        displayName: "Corrected synthetic fund",
        quantity: "",
      });
      expect(database.readPortfolioFacts().state.positions).toEqual([]);
      expect(database.getImportDraft("synthetic-review")?.status).toBe("draft");

      const changedIdentity = structuredClone(review);
      changedIdentity.portfolio.snapshotId = "different-snapshot";
      expect((await handler(new Request("http://localhost/api/imports/synthetic-review/review", {
        method: "PUT",
        body: JSON.stringify(changedIdentity),
      }), "synthetic-review")).status).toBe(400);
      database.close();
      const reopened = createPortfolioDatabase(filename);
      expect(createImportDraftReadModel(reopened.getImportDraft("synthetic-review")!).portfolio.holdings[0]).toMatchObject({
        displayName: "Corrected synthetic fund",
        quantity: "",
      });
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
