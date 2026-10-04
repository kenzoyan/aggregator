import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import { AgentActivityTimeline, analystLimitationKey, AnalystReport } from "@/components/portfolio-analyst";
import { pendingPhaseLabel } from "@/components/portfolio-analyst-transcript";

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
  it("shows verified external citations as clickable links in the answer", () => {
    const external = {
      ...report,
      job: "research-web" as const,
      answer: { ...report.answer, answer: { ...report.answer.answer, evidence: ["call1.web.1"] } },
      evidence: [{
        key: "call1.web.1", kind: "web-research-source" as const,
        label: "External source" as const,
        title: "Official product page",
        url: "https://www.cmfchina.com/fund",
        summary: "The manager lists the C share class.",
        retrievedAt: "2026-10-04T10:00:00.000Z",
        provenance: "openai-web-search" as const,
      }],
    } as PortfolioAnalystReport;
    const markup = renderToStaticMarkup(createElement(AnalystReport, { report: external }));
    expect(markup).toContain('href="https://www.cmfchina.com/fund"');
    expect(markup).toContain("Official product page");
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("explains a failed answer by its safe failure code", () => {
    expect(pendingPhaseLabel("failed", "en", "invalid-provider-output"))
      .toContain("couldn't verify the model's answer");
    expect(pendingPhaseLabel("failed", "zh-CN", "provider-unavailable"))
      .toContain("模型服务暂时无法回应");
    expect(pendingPhaseLabel("failed", "en", "unknown-internal-detail"))
      .not.toContain("unknown-internal-detail");
    expect(pendingPhaseLabel("failed", "en", "toString"))
      .toContain("couldn't finish that reply");
  });

  it("keeps the chat answer conversational and puts evidence in the right panel", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, { report, onShowSources: () => undefined }));
    const sources = renderToStaticMarkup(createElement(AnalystReport, { report, sourcesOnly: true }));
    const messageStart = markup.indexOf("analyst-primary-answer");
    const messageEnd = markup.indexOf("</div>", messageStart);
    const primaryAnswer = markup.indexOf("主答案应该先被看到。");

    expect(primaryAnswer).toBeGreaterThan(-1);
    expect(markup.slice(messageStart, messageEnd)).not.toContain("analyst-classification");
    expect(markup.slice(messageStart, messageEnd)).not.toContain("依据：");
    expect(markup.slice(messageStart, messageEnd)).toContain("analyst-assistant-message");
    expect(markup).not.toContain("第一条补充事实。");
    expect(markup).not.toContain("查看来源与详情");
    expect(markup).toContain("在右侧查看这条回答的来源");
    expect(markup.indexOf("请注意")).toBeGreaterThan(primaryAnswer);
    expect(sources).toContain("第一条补充事实。");
    expect(sources).toContain("限制的依据");
    expect(sources).toContain("建议的事实更新");
    expect(sources).toContain("回答信息");
    expect(sources).toContain("OpenAI · gpt-synthetic");
    expect(sources).not.toContain("主答案应该先被看到。");
    expect(markup).toContain("12:00");
    expect(markup).not.toContain("基于本地事实");
    expect(markup).not.toContain("AI-generated factual explanation");
  });

  it("keeps activity and evidence together in the sources panel", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, { report, sourcesOnly: true }));
    const activity = markup.indexOf('class="analyst-agent-activity"');
    const evidence = markup.indexOf("回答依据");

    expect(activity).toBeGreaterThan(-1);
    expect(evidence).toBeGreaterThan(activity);
    expect(markup).not.toContain("主答案应该先被看到。");
    expect(markup).toContain("已读取 7 天期间表现 · 1 条当前事实");
    expect(markup).not.toContain("选择合适的只读工具");
    expect(markup).not.toContain("生成并验证回答");
  });

  it("omits the activity timeline for old reports without an agent audit", () => {
    const markup = renderToStaticMarkup(createElement(AnalystReport, {
      report: { ...report, agentAudit: undefined },
      sourcesOnly: true,
    }));

    expect(markup).not.toContain('class="analyst-agent-activity"');
    expect(markup).toContain("回答依据");
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

  it("renders account creation as an explicit confirmation instead of an executed action", () => {
    const accountReport: PortfolioAnalystReport = {
      ...report,
      job: "manage-accounts",
      scope: {},
      answer: {
        ...report.answer,
        limitations: [],
        claims: [],
        proposedUpdate: {
          kind: "create-account",
          accountType: "Nordea",
          label: "Brokerage",
          reasonEvidenceKey: "account.proposal",
        },
        answer: {
          text: "I prepared an account proposal.",
          classification: "fact",
          evidence: ["account.proposal"],
        },
      },
      evidence: [{
        key: "account.proposal",
        kind: "source-account-proposal",
        label: "Source account proposal",
        accountType: "Nordea",
        normalizedAccountType: "nordea",
        displayName: "Brokerage",
        alreadyExists: false,
        provenance: "source-account-registry",
      }],
      agentAudit: undefined,
    };

    const markup = renderToStaticMarkup(createElement(AnalystReport, {
      report: accountReport,
      onConfirmCreateAccount: () => undefined,
    }));

    expect(markup).toContain("需要你的确认");
    expect(markup).toContain("确认创建账户");
    expect(markup).toContain("创建账户：Brokerage（Nordea）");
    expect(markup).not.toContain("账户已创建");
  });

  it("asks for the account screenshot in chat without an extra import action card", () => {
    const importReport: PortfolioAnalystReport = {
      ...report,
      job: "manage-accounts",
      scope: {},
      answer: {
        ...report.answer,
        limitations: [],
        claims: [],
        proposedUpdate: {
          kind: "start-account-import",
          accountType: "WeChat Wealth Management",
          label: "WeChat",
          reasonEvidenceKey: "account.import-target",
        },
        answer: {
          text: "I found the account and prepared the import handoff.",
          classification: "fact",
          evidence: ["account.import-target"],
        },
      },
      evidence: [{
        key: "account.import-target",
        kind: "source-account-import-target",
        label: "Source account import target",
        requestedAccountType: "WeChat",
        normalizedAccountType: "wechat",
        accountType: "WeChat Wealth Management",
        displayName: "WeChat",
        updateMethod: "screenshot",
        found: true,
        provenance: "source-account-registry",
      }],
      agentAudit: undefined,
    };

    const markup = renderToStaticMarkup(createElement(AnalystReport, {
      report: importReport,
    }));

    expect(markup).toContain("I found the account and prepared the import handoff.");
    expect(markup).not.toContain("请把 WeChat 的持仓截图发给我。");
    expect(markup).not.toContain("在这里发送截图");
    expect(markup).not.toContain("analyst-import-handoff");
    const apiAccount = renderToStaticMarkup(createElement(AnalystReport, {
      report: {
        ...importReport,
        evidence: importReport.evidence.map((fact) => fact.kind === "source-account-import-target"
          ? { ...fact, updateMethod: "trading-212" as const }
          : fact),
      },
    }));
    expect(apiAccount).toContain("I found the account and prepared the import handoff.");
  });
});
