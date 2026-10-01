import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import {
  namespacePortfolioAnalystContext,
} from "@/application/portfolio-analyst-tools";
import type {
  PortfolioAnalystContextV1,
  PortfolioAnalystTools,
} from "@/application/portfolio-analyst-contract";
import { createPiModelControlledPortfolioAnalyst } from "@/infrastructure/pi/pi-model-controlled-portfolio-analyst";

const usage: Usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model: Model<any> = {
  id: "synthetic-model",
  name: "Synthetic model",
  api: "synthetic",
  provider: "openai",
  baseUrl: "local",
  reasoning: false,
  input: ["text"],
  cost: usage.cost,
  contextWindow: 32_000,
  maxTokens: 1_100,
};

const context: PortfolioAnalystContextV1 = {
  version: "portfolio-analyst-context.v1",
  job: "explain-period-drivers",
  language: "zh-CN",
  factsAsOf: "2026-09-09T10:00:00.000Z",
  scope: { period: "week" },
  definitions: {
    baseCurrency: "EUR",
    holdingCurrencyMeaning: "instrument-quoted-currency",
    portfolioActivityMeaning: "estimated-unexplained-value-movement",
  },
  facts: [{
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
  limitations: [],
  allowedActions: [],
};

const answer = {
  factsAsOf: context.factsAsOf,
  answer: {
    text: "本周上涨 10 欧元，主要来自价格变化。",
    classification: "fact",
    evidence: ["call1.period.total"],
  },
  claims: [],
  limitations: [],
  proposedUpdate: null,
} as const;

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "synthetic",
    provider: "openai",
    model: model.id,
    usage,
    stopReason,
    timestamp: 0,
  };
}

function completedStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: message });
  const block = message.content[0];
  if (block?.type === "toolCall") {
    stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: block, partial: message });
  } else if (block?.type === "text") {
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    stream.push({ type: "text_delta", contentIndex: 0, delta: block.text, partial: message });
    stream.push({ type: "text_end", contentIndex: 0, content: block.text, partial: message });
  }
  stream.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    message,
  });
  stream.end(message);
  return stream;
}

describe("Pi model-controlled Portfolio Analyst", () => {
  it("returns a cited account summary when a model answer is malformed after reading account holdings", async () => {
    const accountContext: PortfolioAnalystContextV1 = {
      ...context,
      job: "manage-accounts",
      scope: {},
      facts: [{
        key: "account.holdings.summary",
        kind: "account-holdings-summary",
        label: "Account holdings summary",
        requestedAccount: "Synthetic Account",
        found: true,
        accountType: "Synthetic Account",
        displayName: "Synthetic Account",
        holdingCount: 1,
        shownHoldingCount: 1,
        totalValueEur: 120,
        provenance: "portfolio-read-model",
      }, {
        key: "account.holding.1",
        kind: "account-holding",
        label: "Account holding",
        name: "Synthetic Fund",
        category: "Fund",
        quantity: "2",
        currency: "EUR",
        originalValue: "EUR 120",
        valueEur: 120,
        freshness: "fresh",
        asOf: "2026-09-09",
        provenance: "portfolio-read-model",
      }],
    };
    let calls = 0;
    const streamFn: StreamFn = () => {
      calls += 1;
      return calls === 1
        ? completedStream(assistant([{
            type: "toolCall",
            id: "account-call",
            name: "read_account_holdings",
            arguments: { accountType: "Synthetic Account" },
          }], "toolUse"))
        : completedStream(assistant([{ type: "text", text: "{}" }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("wrong tool"); },
      readDataQuality: () => { throw new Error("wrong tool"); },
      readPortfolioOverview: () => { throw new Error("wrong tool"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readAccountHoldings: () => accountContext,
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "这个账户有什么资产？",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: true,
      defaultPeriod: "week",
    });

    expect(result.answer.answer.text).toContain("Synthetic Fund");
    expect(result.answer.answer.evidence).toEqual([
      "call1.account.holdings.summary",
      "call1.account.holding.1",
    ]);
    expect(result.audit.toolCalls[0]?.name).toBe("read_account_holdings");
  });

  it("lets the model choose an allowlisted read tool, then validates and audits the answer", async () => {
    const seenContexts: Context[] = [];
    const streamFn: StreamFn = (_model, piContext) => {
      seenContexts.push(piContext);
      if (seenContexts.length === 1) {
        return completedStream(assistant([{
          type: "toolCall",
          id: "tool-call-1",
          name: "read_period_drivers",
          arguments: { period: "week" },
        }], "toolUse"));
      }
      return completedStream(assistant([
        { type: "text", text: JSON.stringify(answer) },
      ], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => context,
      readDataQuality: () => { throw new Error("wrong tool"); },
      readPortfolioOverview: () => { throw new Error("wrong tool"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };
    const deltas: string[] = [];
    const activities: unknown[] = [];

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "本周为什么上涨？",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: false,
      defaultPeriod: "month",
      onToolActivity: (activity) => activities.push(activity),
      onAnswerTextDelta: (delta) => deltas.push(delta),
    });

    expect(seenContexts[0]?.tools?.map((tool) => tool.name)).toEqual([
      "read_period_drivers",
      "read_data_quality",
      "read_portfolio_overview",
      "read_accounts",
      "read_account_holdings",
      "propose_create_account",
      "prepare_account_import",
    ]);
    expect(seenContexts[0]?.systemPrompt).toContain(
      "When the user asks to update or import assets for an existing account",
    );
    expect(seenContexts[0]?.tools?.find((tool) => tool.name === "read_accounts")?.description)
      .toContain("existing-account import requests");
    expect(seenContexts[1]?.messages.at(-1)).toMatchObject({
      role: "toolResult",
      toolName: "read_period_drivers",
      isError: false,
    });
    expect(result.answer).toEqual(answer);
    expect(result.context).toEqual(namespacePortfolioAnalystContext(context, "call1"));
    expect(result.audit).toEqual({
      runtime: "pi-agent-core",
      modelTurns: 2,
      stopReason: "completed",
      toolCalls: [{
        toolCallId: "tool-call-1",
        name: "read_period_drivers",
        input: { period: "week" },
        status: "completed",
        factsAsOf: context.factsAsOf,
        evidenceKeys: ["call1.period.total"],
      }],
    });
    expect(deltas.join("")).toBe(answer.answer.text);
    expect(activities).toEqual([{
      stage: "started",
      toolCallId: "tool-call-1",
      name: "read_period_drivers",
      input: { period: "week" },
    }, {
      stage: "completed",
      toolCallId: "tool-call-1",
      name: "read_period_drivers",
      input: { period: "week" },
      factsAsOf: context.factsAsOf,
      evidenceCount: 1,
    }]);
  });

  it("combines multiple read tools into one validated evidence set", async () => {
    let modelCall = 0;
    let periodReads = 0;
    let qualityReads = 0;
    const streamFn: StreamFn = () => {
      modelCall += 1;
      if (modelCall === 1) {
        return completedStream(assistant([
          { type: "toolCall", id: "period-call", name: "read_period_drivers", arguments: { period: "week" } },
          {
            type: "toolCall",
            id: "quality-call",
            name: "read_data_quality",
            arguments: {},
          },
        ], "toolUse"));
      }
      const combinedAnswer = {
        ...answer,
        answer: { ...answer.answer, evidence: ["call1.period.total", "call2.quality.summary"] },
      };
      return completedStream(assistant([{ type: "text", text: JSON.stringify(combinedAnswer) }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => {
        periodReads += 1;
        return context;
      },
      readDataQuality: () => {
        qualityReads += 1;
        return {
          ...context,
          job: "diagnose-data-quality",
          scope: {},
          facts: [{
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
        };
      },
      readPortfolioOverview: () => { throw new Error("wrong tool"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "本周为什么上涨？",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: false,
      defaultPeriod: "week",
    });

    expect(periodReads).toBe(1);
    expect(qualityReads).toBe(1);
    expect(result.context.facts.map((fact) => fact.key)).toEqual([
      "call1.period.total",
      "call2.quality.summary",
    ]);
    expect(result.audit.toolCalls).toMatchObject([
      { toolCallId: "period-call", status: "completed", evidenceKeys: ["call1.period.total"] },
      { toolCallId: "quality-call", status: "completed", evidenceKeys: ["call2.quality.summary"] },
    ]);
  });

  it("lets the model read the bounded portfolio overview", async () => {
    let modelCall = 0;
    const overviewContext: PortfolioAnalystContextV1 = {
      ...context,
      job: "summarize-portfolio",
      scope: {},
      facts: [{
        key: "overview.summary",
        kind: "portfolio-overview-summary",
        label: "Portfolio overview",
        totalValueEur: 1_000,
        investmentPositionCount: 3,
        sourceAccountCount: 2,
        topThreeSharePercent: 80,
        provenance: "portfolio-insights",
      }],
    };
    const streamFn: StreamFn = () => {
      modelCall += 1;
      if (modelCall === 1) {
        return completedStream(assistant([{
          type: "toolCall",
          id: "overview-call",
          name: "read_portfolio_overview",
          arguments: {},
        }], "toolUse"));
      }
      return completedStream(assistant([{ type: "text", text: JSON.stringify({
        ...answer,
        answer: { ...answer.answer, evidence: ["call1.overview.summary"] },
      }) }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("wrong tool"); },
      readDataQuality: () => { throw new Error("wrong tool"); },
      readPortfolioOverview: () => overviewContext,
      readAccounts: () => { throw new Error("wrong tool"); },
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "概括一下我的投资组合。",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: false,
      defaultPeriod: "week",
    });

    expect(result.context.job).toBe("summarize-portfolio");
    expect(result.context.facts[0]?.key).toBe("call1.overview.summary");
    expect(result.audit.toolCalls[0]).toMatchObject({
      name: "read_portfolio_overview",
      status: "completed",
      evidenceKeys: ["call1.overview.summary"],
    });
  });

  it("lets the model propose but not execute account creation", async () => {
    let modelCall = 0;
    const proposalContext: PortfolioAnalystContextV1 = {
      ...context,
      job: "manage-accounts",
      scope: {},
      facts: [{
        key: "account.proposal",
        kind: "source-account-proposal",
        label: "Source account proposal",
        accountType: "Nordea",
        normalizedAccountType: "nordea",
        displayName: "Brokerage",
        alreadyExists: false,
        provenance: "source-account-registry",
      }],
      allowedActions: [{
        kind: "create-account",
        accountType: "Nordea",
        label: "Brokerage",
        reasonEvidenceKey: "account.proposal",
      }],
    };
    const streamFn: StreamFn = () => {
      modelCall += 1;
      if (modelCall === 1) {
        return completedStream(assistant([{
          type: "toolCall",
          id: "account-proposal-call",
          name: "propose_create_account",
          arguments: { accountType: "Nordea", label: "Brokerage" },
        }], "toolUse"));
      }
      return completedStream(assistant([{ type: "text", text: JSON.stringify({
        factsAsOf: context.factsAsOf,
        answer: {
          text: "已准备账户创建提议，等待你的确认。",
          classification: "fact",
          evidence: ["call1.account.proposal"],
        },
        claims: [],
        limitations: [],
        proposedUpdate: {
          kind: "create-account",
          accountType: "Nordea",
          label: "Brokerage",
          reasonEvidenceKey: "call1.account.proposal",
        },
      }) }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("wrong tool"); },
      readDataQuality: () => { throw new Error("wrong tool"); },
      readPortfolioOverview: () => { throw new Error("wrong tool"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => proposalContext,
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "帮我创建一个 Nordea 账户，名字叫 Brokerage。",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: false,
      defaultPeriod: "week",
    });

    expect(result.answer.proposedUpdate).toEqual({
      kind: "create-account",
      accountType: "Nordea",
      label: "Brokerage",
      reasonEvidenceKey: "call1.account.proposal",
    });
    expect(result.audit.toolCalls[0]).toMatchObject({
      name: "propose_create_account",
      input: { accountType: "Nordea", label: "Brokerage" },
      status: "completed",
    });
  });

  it("lets the model prepare but not execute an account import", async () => {
    let modelCall = 0;
    const importContext: PortfolioAnalystContextV1 = {
      ...context,
      job: "manage-accounts",
      scope: {},
      facts: [{
        key: "account.import-target",
        kind: "source-account-import-target",
        label: "Source account import target",
        requestedAccountType: "WeChat",
        normalizedAccountType: "wechat",
        found: true,
        accountType: "WeChat Wealth Management",
        displayName: "WeChat",
        updateMethod: "screenshot",
        provenance: "source-account-registry",
      }],
      allowedActions: [{
        kind: "start-account-import",
        accountType: "WeChat Wealth Management",
        label: "WeChat",
        reasonEvidenceKey: "account.import-target",
      }],
    };
    const streamFn: StreamFn = () => {
      modelCall += 1;
      if (modelCall === 1) {
        return completedStream(assistant([{
          type: "toolCall",
          id: "account-import-call",
          name: "prepare_account_import",
          arguments: { accountType: "WeChat" },
        }], "toolUse"));
      }
      return completedStream(assistant([{ type: "text", text: JSON.stringify({
        factsAsOf: context.factsAsOf,
        answer: {
          text: "已找到 WeChat 账户，可以开始导入。",
          classification: "fact",
          evidence: ["call1.account.import-target"],
        },
        claims: [],
        limitations: [],
        proposedUpdate: {
          kind: "start-account-import",
          accountType: "WeChat Wealth Management",
          label: "WeChat",
          reasonEvidenceKey: "call1.account.import-target",
        },
      }) }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("wrong tool"); },
      readDataQuality: () => { throw new Error("wrong tool"); },
      readPortfolioOverview: () => { throw new Error("wrong tool"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => importContext,
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "帮我更新 WeChat 资产。",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: true,
      defaultPeriod: "week",
    });

    expect(result.answer.proposedUpdate).toMatchObject({
      kind: "start-account-import",
      accountType: "WeChat Wealth Management",
      label: "WeChat",
    });
    expect(result.audit.toolCalls[0]).toMatchObject({
      name: "prepare_account_import",
      input: { accountType: "WeChat" },
      status: "completed",
    });
  });
});
