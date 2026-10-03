import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createPortfolioAnalystHandlers } from "@/app/api/portfolio/analyst/handler";
import { attachPortfolioAnalystImport, createPortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { draftPortfolioFromOpeningSnapshot } from "@/domain/imports";
import type { StoredImportDraft } from "@/domain/imports";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("cancel an unconfirmed screenshot import", () => {
  it("removes the draft, leaves holdings unchanged, and keeps the cancellation in chat after reopening", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synthetic-import-cancel-"));
    const filename = join(directory, "portfolio.sqlite");
    try {
      const database = createPortfolioDatabase(filename);
      const createdAt = "2026-10-03T10:00:00.000Z";
      database.saveImportDraft({
        id: "synthetic-cancel-draft",
        sourceAccountId: "synthetic-account",
        sourceKind: "screenshot",
        createdAt,
        confidence: "high",
        warnings: [],
        portfolio: draftPortfolioFromOpeningSnapshot({
          id: "synthetic-cancel-snapshot",
          sourceAccountId: "synthetic-account",
          asOf: "2026-10-03T00:00:00.000Z",
          positions: [{ instrumentId: "SYNTH-1", quantity: "2", currency: "EUR", costBasis: "100" }],
        }, "vision"),
      });
      database.savePortfolioAnalystConversation(attachPortfolioAnalystImport(
        createPortfolioAnalystConversation({
          id: "synthetic-conversation", provider: "openai", language: "en",
          includeHoldingNames: true, now: createdAt,
        }),
        { draftId: "synthetic-cancel-draft", targetLabel: "Test account",
          submissionText: "", screenshotCount: 1, createdAt: "2026-10-03T10:01:00.000Z" },
      ));
      const handlers = createPortfolioAnalystHandlers({
        providers: {}, models: { openai: "synthetic", deepseek: "synthetic" }, defaultProvider: "openai",
      }, {
        readCurrentPortfolio: () => undefined,
        conversations: database,
        getImportDraft: (id) => database.getImportDraft(id),
        discardImportDraft: (id) => database.discardImportDraft(id),
        now: () => "2026-10-03T10:02:00.000Z",
      });
      const cancel = () => handlers.PATCH(new Request("http://localhost/api/portfolio/analyst", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "cancel-import", id: "11111111-1111-4111-8111-111111111111",
          conversationId: "synthetic-conversation", draftId: "synthetic-cancel-draft",
          userText: "cancel the import this time",
        }),
      }));

      expect((await cancel()).status).toBe(200);
      expect((await cancel()).status).toBe(200);
      expect(database.getImportDraft("synthetic-cancel-draft")).toBeUndefined();
      expect(database.readPortfolioFacts().state.positions).toEqual([]);
      const payload = await handlers.GET().then((response) => response.json());
      expect(payload.importDrafts).toBeUndefined();
      expect(payload.conversation.importActivities[0]).toMatchObject({
        cancelledAt: "2026-10-03T10:02:00.000Z",
        followUps: [{
          userText: "cancel the import this time",
          assistantText: expect.stringContaining("removed its unconfirmed draft"),
        }],
      });
      expect(payload.conversation.importActivities[0].followUps).toHaveLength(1);
      database.close();

      const reopened = createPortfolioDatabase(filename);
      expect(reopened.getImportDraft("synthetic-cancel-draft")).toBeUndefined();
      expect(reopened.readLatestPortfolioAnalystConversation()?.importActivities[0]?.cancelledAt)
        .toBe("2026-10-03T10:02:00.000Z");
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses to discard a confirmed import", async () => {
    const conversation = attachPortfolioAnalystImport(createPortfolioAnalystConversation({
      id: "confirmed-conversation", provider: "openai", language: "en",
      includeHoldingNames: true, now: "2026-10-03T10:00:00.000Z",
    }), {
      draftId: "confirmed-draft", targetLabel: "Test account", submissionText: "",
      screenshotCount: 1, createdAt: "2026-10-03T10:01:00.000Z",
    });
    const discardImportDraft = vi.fn();
    const handlers = createPortfolioAnalystHandlers({
      providers: {}, models: { openai: "synthetic", deepseek: "synthetic" }, defaultProvider: "openai",
    }, {
      readCurrentPortfolio: () => undefined,
      conversations: {
        readLatestPortfolioAnalystConversation: () => conversation,
        readPortfolioAnalystConversation: () => conversation,
        savePortfolioAnalystConversation: vi.fn(),
        deletePortfolioAnalystConversation: vi.fn(),
      },
      getImportDraft: () => ({ id: "confirmed-draft", status: "confirmed" }) as StoredImportDraft,
      discardImportDraft,
    });
    const response = await handlers.PATCH(new Request("http://localhost/api/portfolio/analyst", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "cancel-import", id: "22222222-2222-4222-8222-222222222222",
        conversationId: "confirmed-conversation", draftId: "confirmed-draft", userText: "cancel import" }),
    }));
    expect(response.status).toBe(409);
    expect(discardImportDraft).not.toHaveBeenCalled();
  });
});
