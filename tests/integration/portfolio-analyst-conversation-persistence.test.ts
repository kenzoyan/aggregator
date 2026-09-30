import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  attachPortfolioAnalystImport,
  appendPortfolioAnalystTurn,
  createPortfolioAnalystConversation,
} from "@/application/portfolio-analyst-conversation";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

function withDatabase(run: (filename: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "analyst-conversation-"));
  const filename = join(directory, "portfolio.sqlite");
  try {
    run(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("portfolio analyst conversation persistence", () => {
  it("saves, restores and deletes a bounded local conversation", () => withDatabase((filename) => {
    const database = createPortfolioDatabase(filename);
    const base = createPortfolioAnalystConversation({
      id: "conversation-1",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: false,
      now: "2026-09-09T10:00:00.000Z",
    });
    const conversation = appendPortfolioAnalystTurn(base, {
      id: "turn-1",
      question: "这个结论可靠吗？",
      createdAt: "2026-09-09T10:01:00.000Z",
      report: {
        provider: "openai",
        model: "synthetic",
        generatedAt: "2026-09-09T10:01:00.000Z",
        contextVersion: "portfolio-analyst-context.v1",
        job: "diagnose-data-quality",
        language: "zh-CN",
        scope: {},
        factsAsOf: "2026-09-09T10:00:00.000Z",
        answer: {
          factsAsOf: "2026-09-09T10:00:00.000Z",
          answer: { text: "数据基本可靠。", classification: "interpretation", evidence: ["quality.summary"] },
          claims: [],
          limitations: [],
          proposedUpdate: null,
        },
        evidence: [{
          key: "quality.summary",
          kind: "quality-summary",
          label: "Data quality summary",
          valuedHoldingCount: 1,
          freshCount: 1,
          manualCount: 0,
          staleCount: 0,
          awaitingNavCount: 0,
          missingInputCount: 0,
          availablePerformancePeriods: ["week"],
          provenance: "portfolio-read-model",
        }],
        disclaimer: "Not investment advice",
      },
    });

    database.savePortfolioAnalystConversation(conversation);
    expect(database.readLatestPortfolioAnalystConversation()).toEqual(conversation);
    expect(database.readPortfolioAnalystConversation("conversation-1")).toEqual(conversation);
    database.deletePortfolioAnalystConversation("conversation-1");
    expect(database.readLatestPortfolioAnalystConversation()).toBeUndefined();
    database.close();
  }));

  it("restores the structured import activity without storing screenshots", () => withDatabase((filename) => {
    const database = createPortfolioDatabase(filename);
    const conversation = attachPortfolioAnalystImport(createPortfolioAnalystConversation({
      id: "conversation-import",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: true,
      now: "2026-09-22T20:00:00.000Z",
    }), {
      draftId: "draft-wechat",
      targetLabel: "WeChat",
      submissionText: "帮我识别一下",
      screenshotCount: 1,
      createdAt: "2026-09-22T20:01:00.000Z",
    });

    database.savePortfolioAnalystConversation(conversation);

    expect(database.readLatestPortfolioAnalystConversation()?.importActivity).toEqual({
      draftId: "draft-wechat",
      targetLabel: "WeChat",
      submissionText: "帮我识别一下",
      screenshotCount: 1,
      createdAt: "2026-09-22T20:01:00.000Z",
    });
    database.close();
  }));

  it("upgrades a schema-v5 database with no conversation table", () => withDatabase((filename) => {
    const current = createPortfolioDatabase(filename);
    current.close();
    const previous = new DatabaseSync(filename);
    previous.exec(`
      DROP TABLE portfolio_analyst_conversations;
      UPDATE schema_metadata SET version = 5;
    `);
    previous.close();

    const upgraded = createPortfolioDatabase(filename);
    expect(upgraded.readLatestPortfolioAnalystConversation()).toBeUndefined();
    upgraded.close();
  }));
});
