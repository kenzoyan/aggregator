import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import { AnalystReport } from "@/components/portfolio-analyst";

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
    limitations: [],
    proposedUpdate: null,
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
  it("shows the primary answer before collapsed supporting facts", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, { report }));
    const primaryAnswer = markup.indexOf("主答案应该先被看到。");
    const supportingFacts = markup.indexOf('class="analyst-supporting-facts"');

    expect(primaryAnswer).toBeGreaterThan(-1);
    expect(supportingFacts).toBeGreaterThan(primaryAnswer);
    expect(markup.slice(supportingFacts, supportingFacts + 100)).not.toContain("open=");
  });

  it("combines cited facts and agent execution behind one disclosure", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, { report }));
    const disclosure = markup.indexOf('class="analyst-evidence-run"');
    const evidence = markup.indexOf("回答依据");
    const execution = markup.indexOf("获取过程");

    expect(disclosure).toBeGreaterThan(-1);
    expect(markup.slice(disclosure, disclosure + 100)).not.toContain("open=");
    expect(markup).not.toContain('<details class="portfolio-agent-audit"');
    expect(markup).not.toContain('<details class="portfolio-analyst-evidence"');
    expect(evidence).toBeGreaterThan(disclosure);
    expect(execution).toBeGreaterThan(evidence);
  });

  it("shows an evidence-only disclosure for reports without an agent audit", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, {
      report: { ...report, agentAudit: undefined },
    }));

    expect(markup).toContain("回答依据");
    expect(markup).not.toContain("依据与执行");
    expect(markup).not.toContain("获取过程");
  });
});
