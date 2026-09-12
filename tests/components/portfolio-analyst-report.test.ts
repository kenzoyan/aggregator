import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import { AgentActivityTimeline, analystLimitationKey, AnalystReport } from "@/components/portfolio-analyst";

const report = {
  provider: "openai",
  model: "gpt-synthetic",
  generatedAt: "2026-09-10T12:00:00.000Z",
  contextVersion: "portfolio-analyst-context.v1",
  job: "explain-period-drivers",
  language: "zh-CN",
  scope: { period: "week" },
  factsAsOf: "2026-09-10T11:59:00.000Z",
  answer: {
    factsAsOf: "2026-09-10T11:59:00.000Z",
    answer: {
      text: "主答案应该先被看到。",
      classification: "fact",
      evidence: ["period.total"],
    },
    claims: [{
      text: "第一条补充事实。",
      classification: "fact",
      evidence: ["period.total"],
    }, {
      text: "第二条补充事实。",
      classification: "fact",
      evidence: ["period.total"],
    }],
    limitations: [{
      code: "partial-period-coverage",
      evidenceKey: "period.total",
    }],
    proposedUpdate: {
      kind: "retry-market-data-refresh",
      reasonEvidenceKey: "period.total",
    },
  },
  evidence: [{
    key: "period.total",
    kind: "period-performance",
    label: "Period performance",
    period: "week",
    coverage: "full",
    changeEur: 10,
    percent: 1,
    priceEffectEur: 8,
    fxEffectEur: 2,
    provenance: "portfolio-performance",
  }],
  agentAudit: {
    runtime: "pi-agent-core",
    modelTurns: 2,
    stopReason: "completed",
    toolCalls: [{
      toolCallId: "tool-1",
      name: "read_period_drivers",
      input: { period: "week" },
      status: "completed",
      factsAsOf: "2026-09-10T11:59:00.000Z",
      evidenceKeys: ["period.total"],
    }],
  },
  disclaimer: "AI-generated factual explanation · Not investment advice",
} as PortfolioAnalystReport;

describe("Portfolio Analyst report hierarchy", () => {
  it("keeps the completed answer conversational and moves supporting facts below it", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, { report }));
    const messageStart = markup.indexOf("analyst-primary-answer");
    const messageEnd = markup.indexOf("</div>", messageStart);
    const primaryAnswer = markup.indexOf("主答案应该先被看到。");
    const disclosure = markup.indexOf('class="analyst-facts-evidence"');
    const supportingFact = markup.indexOf("第一条补充事实。");

    expect(primaryAnswer).toBeGreaterThan(-1);
    expect(markup.slice(messageStart, messageEnd)).not.toContain("analyst-classification");
    expect(markup.slice(messageStart, messageEnd)).not.toContain("依据：");
    expect(markup.slice(messageStart, messageEnd)).toContain("analyst-assistant-message");
    expect(markup).not.toContain('<details class="analyst-supporting-facts"');
    expect(disclosure).toBeGreaterThan(primaryAnswer);
    expect(supportingFact).toBeGreaterThan(disclosure);
    expect(markup.indexOf("已知限制")).toBeGreaterThan(disclosure);
    expect(markup.indexOf("建议的事实更新")).toBeGreaterThan(disclosure);
  });

  it("shows agent activity before the answer and keeps facts in one disclosure below", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, { report }));
    const activity = markup.indexOf('class="analyst-agent-activity"');
    const answer = markup.indexOf("主答案应该先被看到。");
    const disclosure = markup.indexOf('class="analyst-facts-evidence"');
    const evidence = markup.indexOf("回答依据");

    expect(activity).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(activity);
    expect(disclosure).toBeGreaterThan(-1);
    expect(disclosure).toBeGreaterThan(answer);
    expect(markup.slice(disclosure, disclosure + 100)).not.toContain("open=");
    expect(evidence).toBeGreaterThan(disclosure);
    expect(markup).toContain("已读取 7 天期间表现 · 1 条当前事实");
    expect(markup).not.toContain("选择合适的只读工具");
    expect(markup).not.toContain("生成并验证回答");
  });

  it("omits the activity timeline for old reports without an agent audit", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, {
      report: { ...report, agentAudit: undefined },
    }));

    expect(markup).not.toContain('class="analyst-agent-activity"');
    expect(markup).toContain("回答依据");
    expect(markup).toContain("事实与依据");
  });

  it("does not leave interrupted work looking active", () => {
    const markup = renderToStaticMarkup(createElement(AgentActivityTimeline, {
      activities: [{
        stage: "started",
        toolCallId: "tool-interrupted",
        name: "read_data_quality",
        input: {},
      }],
      language: "zh-CN",
      phase: "failed",
      statusHistory: ["selecting-tool", "reading-current-facts"],
    }));

    expect(markup).not.toContain('class="active"');
    expect(markup).toContain('class="failed"');
  });

  it("keeps streamed and persisted tool activity labels consistent", () => {
    const streamed = renderToStaticMarkup(createElement(AgentActivityTimeline, {
      activities: [{
        stage: "started",
        toolCallId: "tool-1",
        name: "read_period_drivers",
        input: { period: "week" },
      }, {
        stage: "completed",
        toolCallId: "tool-1",
        name: "read_period_drivers",
        input: { period: "week" },
        factsAsOf: "2026-09-10T11:59:00.000Z",
        evidenceCount: 1,
      }],
      language: "zh-CN",
      phase: "generating-answer",
      statusHistory: ["selecting-tool", "reading-current-facts", "generating-answer"],
    }));
    const persisted = renderToStaticMarkup(createElement(AgentActivityTimeline, {
      audit: report.agentAudit,
      language: "zh-CN",
      phase: "completed",
    }));

    expect(streamed).toContain("已读取 7 天期间表现 · 1 条当前事实");
    expect(persisted).toContain("已读取 7 天期间表现 · 1 条当前事实");
    expect(streamed.match(/<li/g)).toHaveLength(1);
    expect(persisted.match(/<li/g)).toHaveLength(1);
  });

  it("renders the same limitation for two period evidence keys without duplicate React keys", () => {
    const limitations = [{
      code: "portfolio-activity-cause-unknown" as const,
      evidenceKey: "call1.period.total",
    }, {
      code: "portfolio-activity-cause-unknown" as const,
      evidenceKey: "call2.period.total",
    }];

    expect(new Set(limitations.map(analystLimitationKey)).size).toBe(limitations.length);
  });
});
