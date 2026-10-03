import { describe, expect, it } from "vitest";

import {
  appendPortfolioAnalystImportFollowUp,
  attachPortfolioAnalystImport,
  appendPortfolioAnalystImportImageTurn,
  appendPortfolioAnalystTurn,
  createPortfolioAnalystConversation,
  createPortfolioAnalystHistory,
} from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";

function report(index: number): PortfolioAnalystReport {
  return {
    provider: "openai",
    model: "synthetic",
    generatedAt: `2026-09-09T10:0${index}:00.000Z`,
    contextVersion: "portfolio-analyst-context.v1",
    job: "explain-period-drivers",
    language: "zh-CN",
    scope: { period: "week" },
    factsAsOf: `2026-09-09T10:0${index}:00.000Z`,
    answer: {
      factsAsOf: `2026-09-09T10:0${index}:00.000Z`,
      answer: { text: `回答 ${index}`, classification: "fact", evidence: ["period.total"] },
      claims: [],
      limitations: [],
      proposedUpdate: null,
    },
    evidence: [{
      key: "period.total",
      kind: "period-performance",
      label: "Period performance",
      period: "week",
      coverage: "full",
      changeEur: index,
      percent: index,
      priceEffectEur: index,
      fxEffectEur: 0,
      provenance: "portfolio-performance",
    }],
    disclaimer: "Not investment advice",
  };
}

describe("portfolio analyst conversation", () => {
  it("supplies the recent import target as a reference for follow-up questions", () => {
    const base = createPortfolioAnalystConversation({
      id: "recent-import",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: true,
      now: "2026-09-22T10:00:00.000Z",
    });
    const conversation = attachPortfolioAnalystImport(base, {
      draftId: "synthetic-draft",
      targetLabel: "Synthetic WeChat",
      submissionText: "识别截图",
      screenshotCount: 1,
      createdAt: "2026-09-22T10:01:00.000Z",
    });
    expect(createPortfolioAnalystHistory(conversation).at(-1)?.text)
      .toContain("Synthetic WeChat");
    expect(createPortfolioAnalystHistory({ ...conversation, includeHoldingNames: false }))
      .toEqual([]);
  });

  it("keeps date replies when import activity is retried", () => {
    const base = createPortfolioAnalystConversation({
      id: "conversation-import", provider: "openai", language: "en",
      includeHoldingNames: true, now: "2026-09-22T10:00:00.000Z",
    });
    const activity = {
      draftId: "draft-1", targetLabel: "WeChat", submissionText: "", screenshotCount: 1,
      createdAt: "2026-09-22T10:01:00.000Z",
    };
    const followUp = {
      id: "reply-1", userText: "2026-09-22", assistantText: "Saved the date.",
      createdAt: "2026-09-22T10:02:00.000Z",
    };
    const withReply = appendPortfolioAnalystImportFollowUp(
      attachPortfolioAnalystImport(base, activity), activity.draftId, followUp,
    );
    expect(appendPortfolioAnalystImportFollowUp(withReply, activity.draftId, followUp)
      .importActivities[0]?.followUps).toHaveLength(1);
    expect(attachPortfolioAnalystImport(withReply, activity).importActivities[0]?.followUps)
      .toEqual([followUp]);
  });

  it("keeps settings immutable and retains the full visible conversation", () => {
    let conversation = createPortfolioAnalystConversation({
      id: "conversation-1",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: false,
      now: "2026-09-09T10:00:00.000Z",
    });

    for (let index = 1; index <= 14; index += 1) {
      conversation = appendPortfolioAnalystTurn(conversation, {
        id: `turn-${index}`,
        question: `问题 ${index}`,
        createdAt: `2026-09-09T10:${String(index).padStart(2, "0")}:00.000Z`,
        report: report(index),
      });
    }

    expect(conversation.turns).toHaveLength(14);
    expect(conversation.turns[0]?.question).toBe("问题 1");
    expect(conversation.includeHoldingNames).toBe(false);
  });

  it("adds a separate screenshot message without changing the preceding assistant turn", () => {
    const base = createPortfolioAnalystConversation({
      id: "conversation-images", provider: "openai", language: "en",
      includeHoldingNames: true, now: "2026-09-09T10:00:00.000Z",
    });
    const withTurn = appendPortfolioAnalystTurn(base, {
      id: "turn-1", question: "Analyze the screenshots", createdAt: base.createdAt,
      report: report(1),
    });
    const attached = appendPortfolioAnalystImportImageTurn(withTurn, {
      sourceTurnId: "turn-1", id: "import-image-1", createdAt: "2026-09-09T10:01:00.000Z",
      userText: "", attachments: [{
        id: "11111111-1111-4111-8111-111111111111", mimeType: "image/png", byteLength: 12,
      }],
    });
    expect(attached.turns).toHaveLength(2);
    expect(attached.turns[0]).toEqual(withTurn.turns[0]);
    expect(attached.turns[1]).toMatchObject({
      id: "import-image-1", importImage: { sourceTurnId: "turn-1" }, attachments: [{ mimeType: "image/png" }],
    });
    expect(createPortfolioAnalystHistory(attached).some((message) => message.text === "")).toBe(false);
    expect(() => appendPortfolioAnalystImportImageTurn(attached, {
      sourceTurnId: "turn-1", id: "import-image-2", createdAt: "2026-09-09T10:02:00.000Z",
      userText: "again", attachments: [],
    })).toThrow("The import message cannot accept images.");
  });

  it("projects bounded conversational history without old evidence payloads", () => {
    let conversation = createPortfolioAnalystConversation({
      id: "conversation-1",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: true,
      now: "2026-09-09T10:00:00.000Z",
    });
    for (let index = 1; index <= 5; index += 1) {
      const turnReport = report(index);
      if (index === 5) {
        turnReport.answer.claims = [{
          text: "补充事实",
          classification: "fact",
          evidence: ["period.total"],
        }];
        turnReport.answer.limitations = [{
          code: "partial-period-coverage",
          evidenceKey: "period.total",
        }];
        turnReport.answer.proposedUpdate = {
          kind: "record-dated-market-data",
          reasonEvidenceKey: "period.total",
        };
      }
      conversation = appendPortfolioAnalystTurn(conversation, {
        id: `turn-${index}`,
        question: `问题 ${index}`,
        createdAt: `2026-09-09T10:0${index}:00.000Z`,
        report: turnReport,
      });
    }

    const history = createPortfolioAnalystHistory(conversation);
    expect(history).toHaveLength(6);
    expect(history[0]).toEqual({ role: "user", text: "问题 3" });
    expect(history[1]).toEqual({
      role: "assistant",
      text: "回答 3",
      factsAsOf: "2026-09-09T10:03:00.000Z",
    });
    expect(history.at(-1)).toEqual({
      role: "assistant",
      text: [
        "回答 5",
        "补充事实",
        "限制: 所选期间仅有部分持仓具备完整数据。",
        "建议但未执行: 补充带日期的市场数据",
      ].join("\n"),
      factsAsOf: "2026-09-09T10:05:00.000Z",
    });
    expect(JSON.stringify(history)).not.toContain("changeEur");
  });
});
