import { describe, expect, it } from "vitest";

import {
  attachPortfolioAnalystImport,
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

  it("keeps settings immutable and appends bounded turns", () => {
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

    expect(conversation.turns).toHaveLength(12);
    expect(conversation.turns[0]?.question).toBe("问题 3");
    expect(conversation.includeHoldingNames).toBe(false);
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
