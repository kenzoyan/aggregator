import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createImportMessageHandler } from "@/app/api/portfolio/analyst/import-message/handler";
import { attachPortfolioAnalystImport, createPortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { ImportMessageDecision, ImportMessageInterpreter } from "@/application/imports/import-message-intent";
import { draftPortfolioFromOpeningSnapshot } from "@/domain/imports";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "synthetic-agent-import-message-"));
  const database = createPortfolioDatabase(join(directory, "portfolio.sqlite"));
  const createdAt = "2026-10-03T10:00:00.000Z";
  database.saveImportDraft({
    id: "synthetic-draft", sourceAccountId: "synthetic-account", sourceKind: "screenshot",
    createdAt, confidence: "high", warnings: [],
    portfolio: draftPortfolioFromOpeningSnapshot({
      id: "synthetic-snapshot", sourceAccountId: "synthetic-account",
      asOf: "2026-10-03T00:00:00.000Z",
      positions: [{ instrumentId: "SYNTH-1", displayName: "Synthetic Fund", quantity: "2", currency: "EUR", costBasis: "100" }],
    }, "vision"),
  });
  database.savePortfolioAnalystConversation(attachPortfolioAnalystImport(
    createPortfolioAnalystConversation({
      id: "synthetic-conversation", provider: "openai", language: "en", includeHoldingNames: true, now: createdAt,
    }),
    { draftId: "synthetic-draft", targetLabel: "Synthetic account", submissionText: "Import this screenshot",
      screenshotCount: 1, createdAt: "2026-10-03T10:01:00.000Z" },
  ));
  let count = 0;
  const send = (message: string, id: string, decision: ImportMessageDecision) => {
    const interpreter: ImportMessageInterpreter = { interpret: async () => {
      count += 1;
      return decision;
    } };
    const handler = createImportMessageHandler({
      database, interpreter, now: () => `2026-10-03T10:02:${String(count).padStart(2, "0")}.000Z`,
      createId: () => `confirmed-${count}`,
    });
    return handler(new Request("http://localhost/api/portfolio/analyst/import-message", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, conversationId: "synthetic-conversation", draftId: "synthetic-draft", message }),
    }));
  };
  return { database, directory, send, count: () => count };
}

describe("assistant import message tools", () => {
  it("uses model-selected tools, reports persisted results, and never overwrites earlier replies", async () => {
    const test = fixture();
    try {
      const holdingLineId = test.database.getImportDraft("synthetic-draft")!.portfolio.holdings[0]!.lineId;
      const code = await test.send("the code is TEST123456", "11111111-1111-4111-8111-111111111111", {
        intent: "set-code", value: "TEST123456", holdingLineId,
      });
      expect(code.status).toBe(200);
      expect((await code.json()).draft.portfolio.holdings[0].instrumentCode).toBe("TEST123456");
      expect(test.database.getImportDraft("synthetic-draft")?.status).toBe("draft");

      const ambiguous = await test.send("03 10 2026", "22222222-2222-4222-8222-222222222222", {
        intent: "set-date", field: "valuation-date", value: "2026-10-03",
      });
      expect(ambiguous.status).toBe(200);
      expect((await ambiguous.json()).conversation.importActivities[0].followUps.at(-1).assistantText).toContain("can't tell");
      expect(test.database.getImportDraft("synthetic-draft")?.portfolio.asOf.status).toBe("known");

      const reply = await test.send("what is in this draft?", "33333333-3333-4333-8333-333333333333", {
        intent: "reply", reply: "The draft contains Synthetic Fund.",
      });
      expect(reply.status).toBe(200);
      expect((await reply.json()).conversation.importActivities[0].followUps.at(-1).assistantText).toBe("The draft contains Synthetic Fund.");

      const confirmId = "44444444-4444-4444-8444-444444444444";
      const confirmed = await test.send("looks good help me save it", confirmId, { intent: "confirm" });
      expect(confirmed.status).toBe(200);
      const payload = await confirmed.json();
      expect(payload.portfolioChanged).toBe(true);
      expect(payload.draft.status).toBe("confirmed");
      expect(payload.conversation.importActivities[0].followUps).toHaveLength(4);
      expect(payload.conversation.importActivities[0].followUps.at(-1)).toMatchObject({
        userText: "looks good help me save it", assistantText: expect.stringContaining("assets are updated"),
      });
      expect(test.database.readPortfolioFacts().state.positions).toHaveLength(1);
      const repeated = await test.send("looks good help me save it", confirmId, { intent: "confirm" });
      expect(repeated.status).toBe(200);
      expect((await repeated.json()).conversation.importActivities[0].followUps).toHaveLength(4);
      expect(test.count()).toBe(4);
    } finally {
      test.database.close();
      rmSync(test.directory, { recursive: true, force: true });
    }
  });

  it("delegates unrelated questions without changing the draft or appending a fake tool result", async () => {
    const test = fixture();
    try {
      const response = await test.send("How did my portfolio perform?", "55555555-5555-4555-8555-555555555555", { intent: "other" });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ delegate: true });
      expect(test.database.readLatestPortfolioAnalystConversation()?.importActivities[0]?.followUps).toBeUndefined();
      expect(test.database.getImportDraft("synthetic-draft")?.status).toBe("draft");
    } finally {
      test.database.close();
      rmSync(test.directory, { recursive: true, force: true });
    }
  });

  it("discards only the active draft when the assistant selects cancellation", async () => {
    const test = fixture();
    try {
      const cancelId = "66666666-6666-4666-8666-666666666666";
      const response = await test.send("I don't want to keep this import", cancelId, { intent: "cancel" });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.cancelled).toBe(true);
      expect(payload.portfolioChanged).toBe(false);
      expect(payload.conversation.importActivities[0].followUps).toHaveLength(1);
      expect(payload.conversation.importActivities[0].followUps[0].assistantText).toContain("holdings were not changed");
      expect(test.database.getImportDraft("synthetic-draft")).toBeUndefined();
      expect(test.database.readPortfolioFacts().state.positions).toHaveLength(0);
      const repeated = await test.send("I don't want to keep this import", cancelId, { intent: "cancel" });
      expect(repeated.status).toBe(200);
      expect((await repeated.json()).cancelled).toBe(true);
      expect(test.count()).toBe(1);
    } finally {
      test.database.close();
      rmSync(test.directory, { recursive: true, force: true });
    }
  });

  it("does not discard a confirmed import", async () => {
    const test = fixture();
    try {
      const confirmed = await test.send("Apply the draft", "77777777-7777-4777-8777-777777777777", { intent: "confirm" });
      expect(confirmed.status).toBe(200);
      const cancellation = await test.send("Cancel it", "88888888-8888-4888-8888-888888888888", { intent: "cancel" });
      expect(cancellation.status).toBe(409);
      expect(test.database.getImportDraft("synthetic-draft")?.status).toBe("confirmed");
      expect(test.database.readPortfolioFacts().state.positions).toHaveLength(1);
    } finally {
      test.database.close();
      rmSync(test.directory, { recursive: true, force: true });
    }
  });

  it("restores a cancelled draft conversation after reopening the database", async () => {
    const test = fixture();
    try {
      const response = await test.send("Cancel this import", "99999999-9999-4999-8999-999999999999", { intent: "cancel" });
      expect(response.status).toBe(200);
      test.database.close();
      const reopened = createPortfolioDatabase(join(test.directory, "portfolio.sqlite"));
      try {
        expect(reopened.getImportDraft("synthetic-draft")).toBeUndefined();
        expect(reopened.readLatestPortfolioAnalystConversation()?.importActivities[0]).toMatchObject({
          cancelledAt: expect.any(String),
          followUps: [{ userText: "Cancel this import" }],
        });
        expect(reopened.readPortfolioFacts().state.positions).toHaveLength(0);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(test.directory, { recursive: true, force: true });
    }
  });
});
