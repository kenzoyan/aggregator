import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createPortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { createPortfolioAnalystConversationRepository } from "@/infrastructure/sqlite/portfolio-analyst-conversation-repository";
import { initializePortfolioSchema } from "@/infrastructure/sqlite/portfolio-schema";

describe("Portfolio Agent image references", () => {
  it("restores message text and image metadata from SQLite without storing image bytes", () => {
    const database = new DatabaseSync(":memory:");
    try {
      initializePortfolioSchema(database);
      const repository = createPortfolioAnalystConversationRepository(database);
      const base = createPortfolioAnalystConversation({
        id: "conversation-1", provider: "openai", language: "en",
        includeHoldingNames: true, now: "2026-09-09T10:00:00.000Z",
      });
      repository.savePortfolioAnalystConversation({ ...base, turns: [{
        id: "turn-1", question: "Analyze screenshot", userText: "My holdings",
        createdAt: base.createdAt,
        imageAnswer: {
          status: "pending", text: "", uncertainties: [], provider: "openai",
          model: "synthetic-vision-model", generatedAt: base.createdAt,
        },
        attachments: [{
          id: "11111111-1111-4111-8111-111111111111",
          mimeType: "image/png", byteLength: 19,
        }],
      }] });
      expect(repository.readLatestPortfolioAnalystConversation()?.turns[0]).toMatchObject({
        userText: "My holdings",
        imageAnswer: { status: "pending" },
        attachments: [{ id: "11111111-1111-4111-8111-111111111111", byteLength: 19 }],
      });
      const row = database.prepare("SELECT turns_json FROM portfolio_analyst_conversations WHERE id = ?")
        .get("conversation-1") as { turns_json: string };
      expect(row.turns_json).not.toContain("base64");
    } finally {
      database.close();
    }
  });
});
