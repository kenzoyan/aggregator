import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendPortfolioAnalystTurn, createPortfolioAnalystConversation, createPortfolioAnalystHistory } from "@/application/portfolio-analyst-conversation";
import { createPortfolioAnalystMemoryHandlers } from "@/app/api/portfolio/analyst/memory/handler";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const request = (method: string, body: unknown) => new Request("http://localhost/api/portfolio/analyst/memory", {
  method, body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

describe("confirmed analyst memories", () => {
  it("bounds the list at five confirmed memories", async () => {
    const database = createPortfolioDatabase(":memory:");
    let index = 0;
    const handlers = createPortfolioAnalystMemoryHandlers(database, () => "2026-10-04T10:00:00.000Z", () =>
      `${String(++index).padStart(8, "0")}-1111-4111-8111-111111111111`);
    for (let item = 1; item <= 5; item += 1) {
      expect((await handlers.PUT(request("PUT", {
        content: `Preference ${item}`, source: "settings", confirm: true,
      }))).status).toBe(200);
    }
    expect((await handlers.PUT(request("PUT", {
      content: "Sixth preference", source: "settings", confirm: true,
    }))).status).toBe(409);
    expect(database.listPortfolioAnalystMemories()).toHaveLength(5);
    database.close();
  });

  it("confirms or cancels chat proposals while keeping every chat turn", async () => {
    const database = createPortfolioDatabase(":memory:");
    const conversationId = "conversation-1";
    const base = createPortfolioAnalystConversation({
      id: conversationId, provider: "openai", language: "en", includeHoldingNames: true,
      now: "2026-10-04T10:00:00.000Z",
    });
    const first = appendPortfolioAnalystTurn(base, {
      id: firstId, question: "Remember: Keep answers brief.", createdAt: "2026-10-04T10:01:00.000Z",
      chat: { assistantText: "Review on the right.", memoryProposal: { content: "Keep answers brief.", status: "pending" } },
    });
    database.savePortfolioAnalystConversation(first);
    const handlers = createPortfolioAnalystMemoryHandlers(database, () => "2026-10-04T10:02:00.000Z");
    expect((await handlers.PUT(request("PUT", { conversationId, turnId: firstId }))).status).toBe(400);
    const saved = await handlers.PUT(request("PUT", { conversationId, turnId: firstId, confirm: true }));
    expect(saved.status).toBe(200);
    expect(database.readPortfolioAnalystMemory(firstId)?.content).toBe("Keep answers brief.");
    expect(database.readPortfolioAnalystConversation(conversationId)?.turns[0]?.chat?.memoryProposal?.status).toBe("saved");

    const second = appendPortfolioAnalystTurn(database.readPortfolioAnalystConversation(conversationId)!, {
      id: secondId, question: "Remember: Use headings.", createdAt: "2026-10-04T10:03:00.000Z",
      chat: { assistantText: "Review on the right.", memoryProposal: { content: "Use headings.", status: "pending" } },
    });
    database.savePortfolioAnalystConversation(second);
    const cancelled = await handlers.PATCH(request("PATCH", { conversationId, turnId: secondId, action: "cancel" }));
    expect(cancelled.status).toBe(200);
    const conversation = database.readPortfolioAnalystConversation(conversationId)!;
    expect(conversation.turns).toHaveLength(2);
    expect(conversation.turns.map((turn) => turn.chat?.memoryProposal?.status)).toEqual(["saved", "cancelled"]);
    expect(conversation.turns.map((turn) => turn.chat?.assistantText)).toEqual(["Review on the right.", "Review on the right."]);
    expect(createPortfolioAnalystHistory(conversation)).toMatchObject([
      { role: "user", text: "Remember: Keep answers brief." },
      { role: "assistant", text: "Review on the right." },
      { role: "user", text: "Remember: Use headings." },
      { role: "assistant", text: "Review on the right." },
    ]);
    expect(database.listPortfolioAnalystMemories()).toHaveLength(1);
    database.close();
  });

  it("persists edited proposals without confirming and saves the exact edited text on confirmation", async () => {
    const database = createPortfolioDatabase(":memory:");
    try {
      const base = createPortfolioAnalystConversation({ id: "editable-chat", provider: "openai", language: "en", includeHoldingNames: true,
        now: "2026-10-11T12:00:00.000Z" });
      database.savePortfolioAnalystConversation(appendPortfolioAnalystTurn(base, { id: firstId, question: "Remember my location", createdAt: base.createdAt,
        chat: { assistantText: "Review this draft.", memoryProposal: { content: "I live in Helsinki.", status: "pending" } } }));
      const handlers = createPortfolioAnalystMemoryHandlers(database);
      const context = { conversationId: base.id, turnId: firstId };
      const edit = await handlers.PATCH(request("PATCH", { ...context, action: "update", content: "  I currently live in Espoo.  " }));
      expect(edit.status).toBe(200);
      expect(database.readPortfolioAnalystConversation(base.id)?.turns[0]?.chat).toMatchObject({
        assistantText: "Review this draft.", memoryProposal: { content: "I currently live in Espoo.", status: "pending" },
      });
      expect(database.listPortfolioAnalystMemories()).toEqual([]);
      expect(database.readPortfolioFacts().events).toEqual([]);
      expect((await handlers.PUT(request("PUT", { ...context, confirm: true }))).status).toBe(200);
      expect(database.readPortfolioAnalystMemory(firstId)?.content).toBe("I currently live in Espoo.");
      expect((await handlers.PATCH(request("PATCH", { ...context, action: "update", content: "Other" }))).status).toBe(409);
    } finally { database.close(); }
  });

  it("rejects invalid or foreign proposal edits without changing draft or confirmed memory", async () => {
    const database = createPortfolioDatabase(":memory:");
    try {
      const conversation = createPortfolioAnalystConversation({ id: "edit-safety", provider: "openai", language: "en", includeHoldingNames: true,
        now: "2026-10-11T12:00:00.000Z" });
      conversation.turns = [{ id: firstId, question: "Remember", createdAt: conversation.createdAt,
        chat: { assistantText: "Review", memoryProposal: { content: "Use EUR.", status: "pending" } } }];
      database.savePortfolioAnalystConversation(conversation);
      const handlers = createPortfolioAnalystMemoryHandlers(database);
      const context = { conversationId: conversation.id, turnId: firstId, action: "update" };
      for (const content of ["", "x".repeat(201), "Line one\nLine two", "My password is synthetic"]) {
        expect((await handlers.PATCH(request("PATCH", { ...context, content }))).status).toBe(400);
      }
      expect((await handlers.PATCH(request("PATCH", { ...context, turnId: secondId, content: "Other" }))).status).toBe(409);
      expect((await handlers.PATCH(request("PATCH", { ...context, conversationId: "foreign", content: "Other" }))).status).toBe(404);
      expect(database.readPortfolioAnalystConversation(conversation.id)).toEqual(conversation);
      expect(database.listPortfolioAnalystMemories()).toEqual([]);
    } finally { database.close(); }
  });

  it("confirms, lists, edits, and deletes independent memories across database reopening", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-memories-"));
    directories.push(directory);
    const filename = join(directory, "portfolio.sqlite");
    let database = createPortfolioDatabase(filename);
    let nextId = firstId;
    let handlers = createPortfolioAnalystMemoryHandlers(database, () => "2026-10-04T10:00:00.000Z", () => nextId);
    expect((await handlers.PUT(request("PUT", { content: "Keep answers brief.", source: "chat" }))).status).toBe(400);
    expect(database.listPortfolioAnalystMemories()).toEqual([]);
    expect((await handlers.PUT(request("PUT", { content: "Keep answers brief.", source: "chat", confirm: true }))).status).toBe(200);
    nextId = secondId;
    await handlers.PUT(request("PUT", { content: "Lead with the answer.", source: "settings", confirm: true }));
    expect(database.listPortfolioAnalystMemories()).toHaveLength(2);
    database.close();

    database = createPortfolioDatabase(filename);
    handlers = createPortfolioAnalystMemoryHandlers(database, () => "2026-10-04T11:00:00.000Z");
    expect(database.readPortfolioAnalystMemory(firstId)?.content).toBe("Keep answers brief.");
    await handlers.PUT(request("PUT", { id: firstId, content: "Use concise answers.", source: "settings", confirm: true }));
    expect(database.readPortfolioAnalystMemory(firstId)).toMatchObject({
      content: "Use concise answers.", source: "settings",
      createdAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T11:00:00.000Z",
    });
    expect((await handlers.DELETE(request("DELETE", { id: firstId }))).status).toBe(400);
    expect(database.readPortfolioAnalystMemory(firstId)).toBeDefined();
    await handlers.DELETE(request("DELETE", { id: firstId, confirm: true }));
    expect(database.readPortfolioAnalystMemory(firstId)).toBeUndefined();
    expect(database.readPortfolioAnalystMemory(secondId)?.content).toBe("Lead with the answer.");
    database.close();
  });

  it("migrates a v11 answer-order choice into a normal memory item", () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-memory-migration-"));
    directories.push(directory);
    const filename = join(directory, "portfolio.sqlite");
    const initial = createPortfolioDatabase(filename);
    initial.close();
    const old = new DatabaseSync(filename);
    old.exec(`
      DROP TABLE portfolio_analyst_memories;
      CREATE TABLE portfolio_analyst_memory (
        kind TEXT PRIMARY KEY, value TEXT NOT NULL, source TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO portfolio_analyst_memory VALUES
        ('performance-answer-order', 'eur-first', 'chat', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:00.000Z');
      UPDATE schema_metadata SET version = 11;
    `);
    old.close();
    const upgraded = createPortfolioDatabase(filename);
    expect(upgraded.listPortfolioAnalystMemories()).toMatchObject([{
      id: "migrated-answer-order", content: "When both are available, show the EUR change before the percentage.",
      source: "chat",
    }]);
    upgraded.close();
  });

  it("upgrades a v10 database directly to the memory-list schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "aggregator-memory-v10-"));
    directories.push(directory);
    const filename = join(directory, "portfolio.sqlite");
    const initial = createPortfolioDatabase(filename);
    initial.close();
    const old = new DatabaseSync(filename);
    old.exec("DROP TABLE portfolio_analyst_memories; UPDATE schema_metadata SET version = 10;");
    old.close();
    const upgraded = createPortfolioDatabase(filename);
    expect(upgraded.listPortfolioAnalystMemories()).toEqual([]);
    upgraded.close();
  });
});
