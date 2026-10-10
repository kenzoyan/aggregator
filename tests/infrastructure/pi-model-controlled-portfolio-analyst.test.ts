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
  it("reads and proposes memory in the same agent turn", async () => {
    let modelCall = 0;
    let prompt = "";
    const streamFn: StreamFn = (_model, piContext) => {
      prompt = piContext.systemPrompt ?? "";
      modelCall += 1;
      if (modelCall === 1) return completedStream(assistant([{
        type: "toolCall", id: "memory-read", name: "read_memories", arguments: {},
      }], "toolUse"));
      if (modelCall === 2) return completedStream(assistant([{
        type: "toolCall", id: "memory-proposal", name: "propose_memory",
        arguments: { content: "Answer briefly." },
      }], "toolUse"));
      return completedStream(assistant([{ type: "text", text: "I put a short preference on the right for review." }], "stop"));
    };
    const fail = () => { throw new Error("Unexpected portfolio tool call"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail,
      readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, proposeCreateAccount: fail,
      prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Remember to answer me shortly", history: [], tools, language: "en",
      includeHoldingNames: false, defaultPeriod: "week", memories: [],
    });
    expect(prompt).toContain("Call read_memories");
    expect(result).toMatchObject({ kind: "conversation", memoryProposal: { content: "Answer briefly." },
      audit: { toolCalls: [{ name: "read_memories" }, { name: "propose_memory" }] } });
    expect(modelCall).toBe(3);
  });

  it("rejects a secret in the proposed memory without saving the raw request", async () => {
    let modelCall = 0;
    const streamFn: StreamFn = () => ++modelCall === 1
      ? completedStream(assistant([{ type: "toolCall", id: "memory-proposal", name: "propose_memory",
          arguments: { content: "my api key is abcdef" } }], "toolUse"))
      : completedStream(assistant([{ type: "text", text: "I cannot save that as a preference." }], "stop"));
    const fail = () => { throw new Error("Unexpected portfolio tool call"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail,
      readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, proposeCreateAccount: fail,
      prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Remember my api key", history: [], tools, language: "en",
      includeHoldingNames: false, defaultPeriod: "week", memories: [],
    });
    expect(result).toMatchObject({ kind: "conversation", reply: "I cannot save that as a preference." });
    if (result.kind === "conversation") expect(result.memoryProposal).toBeUndefined();
  });

  it("does not hide an earlier pending proposal behind a second one", async () => {
    let modelCall = 0;
    let toolResult = "";
    const streamFn: StreamFn = (_model, piContext) => {
      if (++modelCall === 1) return completedStream(assistant([{
        type: "toolCall", id: "second-proposal", name: "propose_memory",
        arguments: { content: "Use headings." },
      }], "toolUse"));
      toolResult = JSON.stringify(piContext.messages.at(-1));
      return completedStream(assistant([{ type: "text", text: "Please review the first memory before adding another." }], "stop"));
    };
    const fail = () => { throw new Error("Unexpected portfolio tool call"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail,
      readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, proposeCreateAccount: fail,
      prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Remember to use headings too", history: [], tools, language: "en",
      includeHoldingNames: false, defaultPeriod: "week", memories: [],
      hasPendingMemoryProposal: true,
    });
    expect(toolResult).toContain("already-pending");
    expect(result).toMatchObject({ kind: "conversation", reply: "Please review the first memory before adding another." });
    if (result.kind === "conversation") expect(result.memoryProposal).toBeUndefined();
  });

  it("uses a verified web source as read-only evidence for an external question", async () => {
    let modelCall = 0;
    const streamFn: StreamFn = () => {
      modelCall += 1;
      return modelCall === 1
        ? completedStream(assistant([{
            type: "toolCall", id: "web-call", name: "search_web",
            arguments: { query: "Fund C share class" },
          }], "toolUse"))
        : completedStream(assistant([{ type: "text", text: JSON.stringify({
            factsAsOf: "2026-10-04T10:00:00.000Z",
            answer: { text: "The official page identifies the C share class.", classification: "fact", evidence: ["call1.web.1"] },
            claims: [], limitations: [], proposedUpdate: null,
          }) }], "stop"));
    };
    const unexpected = () => { throw new Error("Portfolio tool should not be called"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: unexpected,
      readDataQuality: unexpected,
      readPortfolioOverview: unexpected,
      readAccounts: unexpected,
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: unexpected,
      proposeCreateAccount: unexpected,
      prepareAccountImport: unexpected,
    };
    const searched: string[] = [];
    const runtime = createPiModelControlledPortfolioAnalyst({
      model, streamFn,
      webResearch: { search: async ({ query }) => {
        searched.push(query);
        return {
          status: "completed", retrievedAt: "2026-10-04T10:00:00.000Z",
          findings: [{ title: "Official product page", url: "https://www.cmfchina.com/fund",
            summary: "The manager lists the C share class." }],
        };
      } },
    });
    const result = await runtime.runTurn({
      question: "What is Fund C's share class?", history: [], tools,
      language: "en", includeHoldingNames: false, defaultPeriod: "week",
      factsAsOf: context.factsAsOf,
    });
    expect(searched).toEqual(["Fund C share class"]);
    expect(result).toMatchObject({
      kind: "report",
      answer: {
        factsAsOf: context.factsAsOf,
        answer: { evidence: ["call1.web.1"] }, proposedUpdate: null,
      },
      context: { job: "research-web", facts: [{ kind: "web-research-source", url: "https://www.cmfchina.com/fund" }] },
      audit: { toolCalls: [{ name: "search_web", status: "completed" }] },
    });
  });

  it.each([
    { question: "Hello", language: "en" as const, reply: "Hello there. What would you like to explore?" },
    { question: "你好", language: "zh-CN" as const, reply: "你好，我在。你想聊什么？" },
  ])("reads confirmed memory before a nonfactual $language reply", async ({ question, language, reply }) => {
    let prompt = "";
    let modelCall = 0;
    let readResult = "";
    const activities: unknown[] = [];
    const streamFn: StreamFn = (_model, piContext) => {
      prompt = piContext.systemPrompt ?? "";
      modelCall += 1;
      if (modelCall === 1) return completedStream(assistant([{
        type: "toolCall", id: "memory-read", name: "read_memories", arguments: {},
      }], "toolUse"));
      readResult = JSON.stringify(piContext.messages.at(-1));
      return completedStream(assistant([{
      type: "text",
      text: JSON.stringify({ kind: "conversation", intent: "greeting", reply }),
      }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("unexpected portfolio read"); },
      readDataQuality: () => { throw new Error("unexpected portfolio read"); },
      readPortfolioOverview: () => { throw new Error("unexpected portfolio read"); },
      readAccounts: () => { throw new Error("unexpected account read"); },
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: () => { throw new Error("unexpected account read"); },
      proposeCreateAccount: () => { throw new Error("unexpected account action"); },
      prepareAccountImport: () => { throw new Error("unexpected import action"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question,
      history: [],
      tools,
      language,
      includeHoldingNames: false,
      defaultPeriod: "week",
      memories: [{ id: "memory-1", content: "Keep answers brief.", source: "chat",
        createdAt: "2026-09-09T10:00:00.000Z", updatedAt: "2026-09-09T10:00:00.000Z" }],
      onToolActivity: (activity) => activities.push(activity),
    });

    expect(prompt).toContain("Confirmed answer preferences are loaded");
    expect(prompt).toContain("Keep answers brief.");
    expect(readResult).toContain("Keep answers brief.");

    expect(result).toMatchObject({
      kind: "conversation",
      reply,
      audit: { modelTurns: 2, toolCalls: [{ name: "read_memories", memoryCount: 1, evidenceKeys: [] }] },
    });
    expect(activities).toContainEqual(expect.objectContaining({
      stage: "completed", name: "read_memories", memoryCount: 1, evidenceCount: 0,
    }));
  });

  it.each([
    "I’m here and ready to help.",
    JSON.stringify({ kind: "conversation", intent: "greeting", extra: "ignored", reply: "I’m here and ready to help." }),
  ])("keeps a model-written social reply in either supported format", async (output) => {
    const streamFn: StreamFn = () => completedStream(assistant([{ type: "text", text: output }], "stop"));
    const fail = () => { throw new Error("Unexpected tool call"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail,
      readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, proposeCreateAccount: fail,
      prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "How are you?", history: [], tools, language: "en",
      includeHoldingNames: false, defaultPeriod: "week",
    });
    expect(result).toMatchObject({ kind: "conversation", reply: "I’m here and ready to help." });
  });

  it("rejects an unsupported no-tool portfolio claim", async () => {
    const streamFn: StreamFn = () => completedStream(assistant([{
      type: "text", text: "Your account balance is EUR 999,999.",
    }], "stop"));
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("unexpected portfolio read"); },
      readDataQuality: () => { throw new Error("unexpected portfolio read"); },
      readPortfolioOverview: () => { throw new Error("unexpected portfolio read"); },
      readAccounts: () => { throw new Error("unexpected account read"); },
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: () => { throw new Error("unexpected account read"); },
      proposeCreateAccount: () => { throw new Error("unexpected account action"); },
      prepareAccountImport: () => { throw new Error("unexpected import action"); },
    };

    await expect(createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "What is my account balance?",
      history: [],
      tools,
      language: "en",
      includeHoldingNames: true,
      defaultPeriod: "week",
    })).rejects.toMatchObject({ code: "invalid-provider-output", diagnosticCode: "invalid-structure" });
  });

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
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
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

    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
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
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
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
      "read_all_holdings",
      "read_accounts",
      "read_account_holdings",
      "read_holding_history",
      "read_account_activity",
      "propose_create_account",
      "prepare_account_import",
      "read_memories",
      "propose_memory",
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
    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
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

  it.each([
    { name: "read_period_drivers", args: { period: "week" }, auditInput: { period: "week" } },
    { name: "read_data_quality", args: {}, auditInput: {} },
    { name: "read_portfolio_overview", args: {}, auditInput: {} },
    { name: "read_accounts", args: {}, auditInput: {} },
    { name: "read_account_holdings", args: { accountType: "Synthetic Account" }, auditInput: { accountType: "Synthetic Account" } },
    { name: "propose_create_account", args: { accountType: "Synthetic Account", label: "My Account" }, auditInput: { accountType: "Synthetic Account", label: "My Account" } },
    { name: "prepare_account_import", args: { accountType: "Synthetic Account" }, auditInput: { accountType: "Synthetic Account" } },
  ])("preserves $name activity, audit input and namespaced evidence", async ({ name, args, auditInput }) => {
    let modelCall = 0;
    const streamFn: StreamFn = () => {
      modelCall += 1;
      return modelCall === 1
        ? completedStream(assistant([{
            type: "toolCall", id: "selected-tool", name, arguments: args,
          }], "toolUse"))
        : completedStream(assistant([{ type: "text", text: JSON.stringify(answer) }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => context,
      readDataQuality: () => context,
      readPortfolioOverview: () => context,
      readAccounts: () => context,
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: () => context,
      proposeCreateAccount: () => context,
      prepareAccountImport: () => context,
    };
    const activities: unknown[] = [];
    const phases: string[] = [];

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Synthetic question",
      history: [], tools, language: "zh-CN", includeHoldingNames: true, defaultPeriod: "week",
      onToolActivity: (activity) => activities.push(activity),
      onPhase: (phase) => phases.push(phase),
    });

    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
    expect(result.answer).toEqual(answer);
    expect(result.audit.toolCalls).toMatchObject([{
      name, input: auditInput, status: "completed", evidenceKeys: ["call1.period.total"],
    }]);
    expect(activities).toMatchObject([
      { stage: "started", name, input: auditInput },
      { stage: "completed", name, input: auditInput, evidenceCount: 1 },
    ]);
    expect(phases).toEqual(["reading-current-facts", "generating-answer"]);
  });

  it("blocks a fifth tool call before it reads portfolio data", async () => {
    let modelCall = 0;
    let reads = 0;
    const streamFn: StreamFn = () => {
      modelCall += 1;
      return modelCall === 1
        ? completedStream(assistant(Array.from({ length: 5 }, (_, index) => ({
            type: "toolCall" as const,
            id: `read-${index + 1}`,
            name: "read_data_quality",
            arguments: {},
          })), "toolUse"))
        : completedStream(assistant([{ type: "text", text: JSON.stringify(answer) }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("wrong tool"); },
      readDataQuality: () => { reads += 1; return context; },
      readPortfolioOverview: () => { throw new Error("wrong tool"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Read data repeatedly",
      history: [], tools, language: "zh-CN", includeHoldingNames: false, defaultPeriod: "week",
    });
    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
    expect(reads).toBe(4);
    expect(result.audit.toolCalls).toMatchObject([
      { status: "completed", evidenceKeys: ["call1.period.total"] },
      { status: "completed", evidenceKeys: ["call2.period.total"] },
      { status: "completed", evidenceKeys: ["call3.period.total"] },
      { status: "completed", evidenceKeys: ["call4.period.total"] },
      { status: "blocked", errorCode: "tool-budget-exceeded", evidenceKeys: [] },
    ]);
  });

  it("returns a read-limit result so the Agent can finish after a blocked call", async () => {
    let modelCall = 0;
    let reads = 0;
    let blockedResult = "";
    const streamFn: StreamFn = (_model, piContext) => {
      modelCall += 1;
      if (modelCall <= 5) return completedStream(assistant([{
        type: "toolCall", id: `read-${modelCall}`, name: "read_data_quality", arguments: {},
      }], "toolUse"));
      blockedResult = JSON.stringify(piContext.messages.at(-1));
      return completedStream(assistant([{ type: "text", text: JSON.stringify(answer) }], "stop"));
    };
    const fail = () => { throw new Error("Unexpected tool"); };
    const tools: PortfolioAnalystTools = {
      readDataQuality: () => { reads += 1; return context; },
      readPeriodDrivers: fail, readPortfolioOverview: fail,
      readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail,
      proposeCreateAccount: fail, prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Read repeatedly", history: [], tools, language: "zh-CN",
      includeHoldingNames: false, defaultPeriod: "week",
    });
    expect(result.kind).toBe("report");
    expect(reads).toBe(4);
    expect(blockedResult).toContain("tool-budget-exceeded");
    expect(modelCall).toBe(6);
  });

  it("lets the Agent explain a failed read without inventing current facts", async () => {
    let modelCall = 0;
    let failureResult = "";
    const activities: unknown[] = [];
    const streamFn: StreamFn = (_model, piContext) => {
      modelCall += 1;
      if (modelCall > 1) failureResult = JSON.stringify(piContext.messages.at(-1));
      return modelCall === 1
        ? completedStream(assistant([{
            type: "toolCall", id: "failed-read", name: "read_data_quality", arguments: {},
          }], "toolUse"))
        : completedStream(assistant([{ type: "text", text: "I couldn't read the current data quality, so I can't verify its freshness yet." }], "stop"));
    };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => { throw new Error("wrong tool"); },
      readDataQuality: () => { throw new Error("Synthetic read failed"); },
      readPortfolioOverview: () => { throw new Error("wrong tool"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Is my data current?",
      history: [], tools, language: "en", includeHoldingNames: false, defaultPeriod: "week",
      onToolActivity: (activity) => activities.push(activity),
    });
    expect(result).toMatchObject({
      kind: "conversation",
      reply: "I couldn't read the current data quality, so I can't verify its freshness yet.",
      audit: { toolCalls: [{ name: "read_data_quality", status: "failed", errorCode: "tool-execution-failed" }] },
    });
    expect(failureResult).toContain("tool-execution-failed");
    expect(JSON.parse(failureResult)).toMatchObject({ isError: true });
    expect(failureResult).not.toContain("Synthetic read failed");
    expect(activities).toMatchObject([
      { stage: "started", name: "read_data_quality" },
      { stage: "failed", name: "read_data_quality", errorCode: "tool-execution-failed" },
    ]);
  });

  it("continues from a failed read to a successful evidenced answer", async () => {
    let modelCall = 0;
    const streamFn: StreamFn = () => {
      modelCall += 1;
      if (modelCall === 1) return completedStream(assistant([{
        type: "toolCall", id: "failed-quality", name: "read_data_quality", arguments: {},
      }], "toolUse"));
      if (modelCall === 2) return completedStream(assistant([{
        type: "toolCall", id: "working-period", name: "read_period_drivers", arguments: { period: "week" },
      }], "toolUse"));
      return completedStream(assistant([{ type: "text", text: JSON.stringify({
        ...answer,
        answer: { ...answer.answer,
          text: "本周上涨 10 欧元。数据质量读取失败，因此无法核实数据是否最新。" },
      }) }], "stop"));
    };
    const fail = () => { throw new Error("Synthetic internal failure"); };
    const tools: PortfolioAnalystTools = {
      readDataQuality: fail, readPeriodDrivers: () => context,
      readPortfolioOverview: fail, readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail,
      proposeCreateAccount: fail, prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "What changed this week?", history: [], tools, language: "zh-CN",
      includeHoldingNames: false, defaultPeriod: "week",
    });
    expect(result).toMatchObject({
      kind: "report",
      answer: { answer: { text: "本周上涨 10 欧元。数据质量读取失败，因此无法核实数据是否最新。",
        evidence: ["call1.period.total"] } },
      audit: { toolCalls: [
        { name: "read_data_quality", status: "failed", evidenceKeys: [] },
        { name: "read_period_drivers", status: "completed", evidenceKeys: ["call1.period.total"] },
      ] },
    });
    expect(modelCall).toBe(3);
  });

  it("gives the Agent a safe timeout reason without exposing the tool exception", async () => {
    let modelCall = 0;
    let toolResult = "";
    const streamFn: StreamFn = (_model, piContext) => {
      if (++modelCall === 1) return completedStream(assistant([{
        type: "toolCall", id: "timed-out-read", name: "read_data_quality", arguments: {},
      }], "toolUse"));
      toolResult = JSON.stringify(piContext.messages.at(-1));
      return completedStream(assistant([{ type: "text", text: "The data check timed out. Please try again." }], "stop"));
    };
    const fail = () => { throw new Error("Request timed out: private internal endpoint"); };
    const tools: PortfolioAnalystTools = {
      readDataQuality: fail, readPeriodDrivers: fail, readPortfolioOverview: fail,
      readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, proposeCreateAccount: fail,
      prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Is my data current?", history: [], tools, language: "en",
      includeHoldingNames: false, defaultPeriod: "week",
    });
    expect(result).toMatchObject({ kind: "conversation", audit: { toolCalls: [{ errorCode: "tool-timeout" }] } });
    expect(toolResult).toContain("tool-timeout");
    expect(toolResult).not.toContain("private internal endpoint");
  });

  it("keeps a safe diagnostic code when a generated answer cites missing evidence", async () => {
    let modelCall = 0;
    const streamFn: StreamFn = () => ++modelCall === 1
      ? completedStream(assistant([{
          type: "toolCall", id: "read-1", name: "read_period_drivers", arguments: { period: "week" },
        }], "toolUse"))
      : completedStream(assistant([{ type: "text", text: JSON.stringify({
          factsAsOf: context.factsAsOf,
          answer: { text: "A claim without a source.", classification: "fact", evidence: ["missing"] },
          claims: [], limitations: [], proposedUpdate: null,
        }) }], "stop"));
    const unexpected = () => { throw new Error("Unexpected tool"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => context,
      readDataQuality: unexpected, readPortfolioOverview: unexpected, readAccounts: unexpected,
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: unexpected, proposeCreateAccount: unexpected, prepareAccountImport: unexpected,
    };
    await expect(createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "What changed?", history: [], tools, language: "zh-CN",
      includeHoldingNames: false, defaultPeriod: "week",
    })).rejects.toMatchObject({ code: "invalid-provider-output", diagnosticCode: "unknown-evidence" });
    expect(modelCall).toBe(3);
  });

  it("repairs one invalid evidence reference using only current evidence keys", async () => {
    let modelCall = 0;
    let repairToolCount = -1;
    let repairPrompt = "";
    const streamFn: StreamFn = (_model, piContext) => {
      modelCall += 1;
      if (modelCall === 1) return completedStream(assistant([{
        type: "toolCall", id: "read-1", name: "read_period_drivers", arguments: { period: "week" },
      }], "toolUse"));
      if (modelCall === 2) return completedStream(assistant([{ type: "text", text: JSON.stringify({
        ...answer, answer: { ...answer.answer, evidence: ["made-up"] },
      }) }], "stop"));
      repairToolCount = piContext.tools?.length ?? 0;
      repairPrompt = JSON.stringify(piContext.messages.at(-1));
      return completedStream(assistant([{ type: "text", text: JSON.stringify(answer) }], "stop"));
    };
    const fail = () => { throw new Error("Unexpected tool"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => context, readDataQuality: fail, readPortfolioOverview: fail,
      readAccounts: fail, readHoldingHistory: fail, readAccountActivity: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, proposeCreateAccount: fail,
      prepareAccountImport: fail,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "What changed this week?", history: [], tools, language: "zh-CN",
      includeHoldingNames: false, defaultPeriod: "week",
    });
    expect(result).toMatchObject({ kind: "report", answer: { answer: { evidence: ["call1.period.total"] } } });
    expect(modelCall).toBe(3);
    expect(repairToolCount).toBe(0);
    expect(repairPrompt).toContain("call1.period.total");
  });

  it.each([
    { label: "omits", generatedLimitations: undefined },
    { label: "changes", generatedLimitations: [{ code: "period-unavailable", evidenceKey: "made-up" }] },
  ])("uses trusted current limitations when the model $label them", async ({ generatedLimitations }) => {
    let modelCall = 0;
    const periodContext: PortfolioAnalystContextV1 = {
      ...context,
      limitations: [{ code: "portfolio-activity-cause-unknown", evidenceKey: "period.total" }],
    };
    const streamFn: StreamFn = () => ++modelCall === 1
      ? completedStream(assistant([{
          type: "toolCall", id: "read-1", name: "read_period_drivers", arguments: { period: "week" },
        }], "toolUse"))
      : completedStream(assistant([{ type: "text", text: JSON.stringify({
          factsAsOf: context.factsAsOf,
          answer: { text: "The portfolio gained EUR 10.", classification: "fact", evidence: ["call1.period.total"] },
          claims: [], proposedUpdate: null,
          ...(generatedLimitations === undefined ? {} : { limitations: generatedLimitations }),
        }) }], "stop"));
    const unexpected = () => { throw new Error("Unexpected tool"); };
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: () => periodContext,
      readDataQuality: unexpected, readPortfolioOverview: unexpected, readAccounts: unexpected,
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: unexpected, proposeCreateAccount: unexpected, prepareAccountImport: unexpected,
    };
    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "Which holdings affected my portfolio most?", history: [], tools,
      language: "zh-CN", includeHoldingNames: false, defaultPeriod: "week",
    });
    expect(result.kind).toBe("report");
    if (result.kind !== "report") return;
    expect(result.answer.limitations).toEqual([{
      code: "portfolio-activity-cause-unknown", evidenceKey: "call1.period.total",
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
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
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
    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
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
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
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

    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
    expect(result.context.job).toBe("summarize-portfolio");
    expect(result.context.facts[0]?.key).toBe("call1.overview.summary");
    expect(result.audit.toolCalls[0]).toMatchObject({
      name: "read_portfolio_overview",
      status: "completed",
      evidenceKeys: ["call1.overview.summary"],
    });
  });

  it("reads a complete asset summary with one audited tool call", async () => {
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
          name: "read_all_holdings",
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
      readPortfolioOverview: () => { throw new Error("Unexpected duplicate overview read"); },
      readAccounts: () => { throw new Error("wrong tool"); },
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => overviewContext,
      readAccountHoldings: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };

    const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
      question: "总结所有账户及每一项持仓。",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: false,
      defaultPeriod: "week",
    });

    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
    expect(result.audit.toolCalls).toHaveLength(1);
    expect(modelCall).toBe(2);
    expect(result.context.job).toBe("summarize-portfolio");
    expect(result.context.facts[0]?.key).toBe("call1.overview.summary");
    expect(result.audit.toolCalls[0]).toMatchObject({
      name: "read_all_holdings",
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
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
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

    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
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
      readHoldingHistory: () => { throw new Error("unexpected history tool"); },
      readAccountActivity: () => { throw new Error("unexpected activity tool"); },
      readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
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

    if (result.kind !== "report") throw new Error("Expected an evidenced report.");
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


it.each(["read_holding_history", "read_account_activity"] as const)("executes %s and validates its namespaced citations without writes", async (name) => {
  const historyContext: PortfolioAnalystContextV1 = {
    ...context, job: "manage-accounts", scope: {},
    facts: [{ key: "history.summary", kind: "activity-history-summary", label: "Recorded history summary",
      requestedAccount: "Test", status: "found", recordCount: 1, shownRecordCount: 1,
      coverage: "recorded-history-only", provenance: "portfolio-ledger" }],
    limitations: [], allowedActions: [],
  };
  let calls = 0;
  const fail = () => { throw new Error("Unexpected tool"); };
  const params = { accountType: "Test", fromDate: "2026-01-01", ...(name === "read_holding_history" ? { holding: "Fund" } : {}) };
  const historyRead = (input: unknown) => {
    expect(input).toMatchObject({ ...params, language: "zh-CN", includeHoldingNames: true });
    return historyContext;
  };
  const tools: PortfolioAnalystTools = {
    readHoldingHistory: historyRead, readAccountActivity: historyRead,
    readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail,
    readAccounts: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, proposeCreateAccount: fail, prepareAccountImport: fail,
  };
  const streamFn: StreamFn = () => ++calls === 1
    ? completedStream(assistant([{ type: "toolCall", id: "history-call", name, arguments: params }], "toolUse"))
    : completedStream(assistant([{ type: "text", text: JSON.stringify({
      factsAsOf: context.factsAsOf,
      answer: { text: "有一条已记录的活动。", classification: "fact", evidence: ["call1.history.summary"] },
      claims: [], limitations: [], proposedUpdate: null,
    }) }], "stop"));
  const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
    question: "查询历史", history: [], tools, language: "zh-CN", includeHoldingNames: true, defaultPeriod: "week",
  });
  if (result.kind !== "report") throw new Error("Expected evidenced report");
  expect(result.audit.toolCalls[0]).toMatchObject({ name, input: params, status: "completed", evidenceKeys: ["call1.history.summary"] });
  expect(result.answer.answer.evidence).toEqual(["call1.history.summary"]);
  expect(result.answer.proposedUpdate).toBeNull();
});

it("reads a trusted workflow result and saved preferences before producing its own operation reply", async () => {
  const fail = () => { throw new Error("Unexpected portfolio tool"); };
  const tools: PortfolioAnalystTools = {
    readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail,
    readAccounts: fail, readAllHoldings: () => { throw new Error("Unexpected all-holdings read"); },
      readAccountHoldings: fail, readHoldingHistory: fail, readAccountActivity: fail,
    proposeCreateAccount: fail, prepareAccountImport: fail,
  };
  const workflowResult = { workflow: "sale" as const, operation: "prepare" as const, status: "failed" as const,
    recordedAt: context.factsAsOf, portfolioChanged: false, code: "duplicate-image",
    details: "This screenshot already has a saved sale." };
  let calls = 0;
  const seen: Context[] = [];
  const streamFn: StreamFn = (_model, piContext) => {
    seen.push(piContext); calls += 1;
    if (calls === 1) return completedStream(assistant([{ type: "toolCall", id: "result", name: "read_workflow_result", arguments: {} }], "toolUse"));
    if (calls === 2) return completedStream(assistant([{ type: "toolCall", id: "memory", name: "read_memories", arguments: {} }], "toolUse"));
    return completedStream(assistant([{ type: "text", text: "这张截图的卖出已经记录过了，这次没有重复入账。" }], "stop"));
  };
  const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
    question: "帮我记录这笔卖出", history: [], tools, workflowResult, language: "en",
    includeHoldingNames: true, defaultPeriod: "week",
    memories: [{ id: "m", content: "Answer briefly.", source: "settings", createdAt: context.factsAsOf, updatedAt: context.factsAsOf }],
  });
  expect(seen[0].tools?.map((tool) => tool.name)).toEqual(["read_workflow_result", "read_memories"]);
  expect(seen[1].messages.at(-1)).toMatchObject({ role: "toolResult", toolName: "read_workflow_result" });
  expect(JSON.stringify(seen[1].messages.at(-1))).toContain("duplicate-image");
  expect(result).toMatchObject({ kind: "conversation", reply: "这张截图的卖出已经记录过了，这次没有重复入账。" });
  expect(result.audit.toolCalls.map((call) => call.name)).toEqual(["read_workflow_result", "read_memories"]);
});


it("loads confirmed preferences before the first model request and lets the main agent explain image observations", async () => {
  let calls = 0;
  let reads = 0;
  const streamFn: StreamFn = (_model, ctx) => {
    expect(ctx.systemPrompt).toContain("Always address me as Owner.");
    expect(ctx.tools?.map((tool) => tool.name)).toEqual(["read_image", "read_memories"]);
    if (++calls === 1) return completedStream(assistant([{ type: "toolCall", id: "image", name: "read_image", arguments: {} }], "toolUse"));
    expect(JSON.stringify(ctx.messages.at(-1))).toContain("Visible balance: 100 EUR");
    return completedStream(assistant([{ type: "text", text: "Owner, the screenshot shows 100 EUR." }], "stop"));
  };
  const fail = () => { throw new Error("Unexpected portfolio read"); };
  const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
    question: "Explain this", history: [], language: "en", includeHoldingNames: true, defaultPeriod: "week",
    tools: { readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail, readAllHoldings: fail,
      readAccounts: fail, readAccountHoldings: fail, readHoldingHistory: fail, readAccountActivity: fail,
      proposeCreateAccount: fail, prepareAccountImport: fail },
    memories: [{ id: "preference", content: "Always address me as Owner.", source: "settings", createdAt: "2026-10-10", updatedAt: "2026-10-10" }],
    imageAnalysis: { read: async () => { reads++; return { answer: "Visible balance: 100 EUR", uncertainties: [] }; } },
  });
  expect(reads).toBe(1);
  expect(result).toMatchObject({ kind: "conversation", reply: "Owner, the screenshot shows 100 EUR.", audit: { toolCalls: [{ name: "read_image", status: "completed" }] } });
});


it("exposes only draft operations and returns a conversational outcome after portfolio reads and a draft operation", async () => {
  let calls = 0;
  const operations: string[] = [];
  const streamFn: StreamFn = (_model, ctx) => {
    expect(ctx.systemPrompt).toContain("Always address me as Owner.");
    expect(ctx.tools?.some((tool) => /confirm|save|undo/.test(tool.name))).toBe(false);
    if (++calls === 1) return completedStream(assistant([{ type: "toolCall", id: "accounts", name: "read_accounts", arguments: {} }], "toolUse"));
    if (calls === 2) return completedStream(assistant([{ type: "toolCall", id: "prepare", name: "prepare_sale_draft", arguments: { sale: { status: "completed", accountName: null, name: "Synthetic Fund", symbol: null, date: null, quantity: null, gross: null, net: "100", fees: null, currency: "EUR", destination: null, destinationName: null, warnings: [] } } }], "toolUse"));
    expect(JSON.stringify(ctx.messages.at(-1))).toContain("portfolioChanged");
    return completedStream(assistant([{ type: "text", text: "Owner, please review the draft before saving." }], "stop"));
  };
  const fail = () => { throw new Error("Unexpected read"); };
  const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
    question: "Record my completed sale", history: [], language: "en", includeHoldingNames: true, defaultPeriod: "week",
    tools: { readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail, readAllHoldings: fail,
      readAccounts: () => context, readAccountHoldings: fail, readHoldingHistory: fail, readAccountActivity: fail,
      proposeCreateAccount: fail, prepareAccountImport: fail },
    memories: [{ id: "preference", content: "Always address me as Owner.", source: "settings", createdAt: "2026-10-10", updatedAt: "2026-10-10" }],
    draftTools: { execute: async (name) => { operations.push(name); return { workflow: "sale", operation: "prepare", status: "succeeded", recordedAt: "2026-10-10", portfolioChanged: false }; } },
  });
  expect(operations).toEqual(["prepare_sale_draft"]);
  expect(result).toMatchObject({ kind: "conversation", reply: "Owner, please review the draft before saving.", audit: { toolCalls: [{ name: "read_accounts" }, { name: "prepare_sale_draft" }] } });
});

it("passes original current and historical images to the main model with confirmed memory, without read_image", async () => {
  const fail = () => { throw new Error("No tool is needed to explain a supplied image"); };
  const streamFn: StreamFn = (_model, ctx) => {
    expect(ctx.systemPrompt).toContain("Always address me as Owner.");
    expect(ctx.tools?.some((tool) => tool.name === "read_image")).toBe(false);
    expect(ctx.messages[0]).toMatchObject({ role: "user", content: [
      { type: "text", text: "Earlier image" }, { type: "image", data: "AQ==", mimeType: "image/png" },
    ] });
    expect(ctx.messages[1]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Earlier answer" }] });
    expect(ctx.messages.at(-1)).toMatchObject({ role: "user", content: [
      { type: "text", text: "Explain this second image" }, { type: "image", data: "Ag==", mimeType: "image/png" },
    ] });
    return completedStream(assistant([{ type: "text", text: "Owner, the second screenshot shows 100 EUR. This is a screenshot observation." }], "stop"));
  };
  const result = await createPiModelControlledPortfolioAnalyst({ model, streamFn }).runTurn({
    question: "Explain this second image", images: [{ data: "Ag==", mimeType: "image/png" }],
    history: [{ role: "user", text: "Earlier image", images: [{ id: "first", data: "AQ==", mimeType: "image/png" }] },
      { role: "assistant", text: "Earlier answer", factsAsOf: "2026-01-01" }],
    language: "en", includeHoldingNames: true, defaultPeriod: "week",
    memories: [{ id: "preference", content: "Always address me as Owner.", source: "settings", createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
    tools: { readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail, readAllHoldings: fail,
      readAccounts: fail, readAccountHoldings: fail, readHoldingHistory: fail, readAccountActivity: fail,
      proposeCreateAccount: fail, prepareAccountImport: fail },
  });
  expect(result).toMatchObject({ kind: "conversation", reply: expect.stringContaining("100 EUR"), audit: { toolCalls: [] } });
});

it("keeps image observations and web evidence together, then explains the historical image on follow-up", async () => {
  const fail = () => { throw new Error("Unexpected portfolio operation"); };
  const tools: PortfolioAnalystTools = {
    readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail,
    readAllHoldings: fail, readAccounts: fail, readAccountHoldings: fail,
    readHoldingHistory: fail, readAccountActivity: fail, proposeCreateAccount: fail, prepareAccountImport: fail,
  };
  let modelCalls = 0;
  let searches = 0;
  const mixedAnswer = "Nasdaq-100 closed at 20,000. Your screenshot shows a fund value of 1,244.33 CNY; this is the image's recorded value, not a live account balance.";
  const runtime = createPiModelControlledPortfolioAnalyst({ model,
    webResearch: { search: async () => {
      searches += 1;
      return { status: "completed", retrievedAt: context.factsAsOf,
        findings: [{ title: "Synthetic index close", url: "https://www.nasdaq.com/test", summary: "Index closed at 20,000." }] };
    } },
    streamFn: (_model, ctx) => {
      modelCalls += 1;
      expect(ctx.systemPrompt).toContain('"key":"image.1"');
      expect(ctx.systemPrompt).toContain("Answer every part of the latest user request");
      expect(ctx.systemPrompt).toContain("Earlier topics are context, not tasks to repeat");
      if (modelCalls === 1) return completedStream(assistant([{
        type: "toolCall", id: "search", name: "search_web", arguments: { query: "Nasdaq-100 latest close" },
      }], "toolUse"));
      if (modelCalls === 2) {
        // The original image must still be visible after the search tool returns.
        expect(ctx.messages.some((message) => message.role === "user" && Array.isArray(message.content) &&
          message.content.some((block) => block.type === "image" && block.data === "AQ=="))).toBe(true);
        return completedStream(assistant([{ type: "text", text: JSON.stringify({
          factsAsOf: context.factsAsOf, answer: { text: mixedAnswer, classification: "fact", evidence: ["call1.web.1", "image.1"] },
          claims: [{ text: "The screenshot shows 1,244.33 CNY.", classification: "fact", evidence: ["image.1"] }],
          limitations: [], proposedUpdate: null,
        }) }], "stop"));
      }
      expect(ctx.messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "text", text: "Explain the most recently uploaded image" }] });
      expect(ctx.messages[0]).toMatchObject({ role: "user", content: [
        { type: "text" }, { type: "image", data: "AQ==", mimeType: "image/png" },
      ] });
      return completedStream(assistant([{ type: "text", text: "The screenshot shows your fund's recorded value of 1,244.33 CNY." }], "stop"));
    },
  });
  const base = { tools, language: "en" as const, includeHoldingNames: true, defaultPeriod: "week" as const, factsAsOf: context.factsAsOf };
  const result = await runtime.runTurn({ ...base, question: "Check Nasdaq-100 and also explain this image", history: [],
    images: [{ data: "AQ==", mimeType: "image/png" }] });
  expect(result).toMatchObject({ kind: "report", answer: { answer: { text: mixedAnswer, evidence: ["call1.web.1", "image.1"] } },
    context: { facts: [{ kind: "web-research-source" }, { key: "image.1", kind: "conversation-image", provenance: "user-supplied-image" }] } });
  const followup = await runtime.runTurn({ ...base, question: "Explain the most recently uploaded image", history: [
    { role: "user", text: "Check Nasdaq-100 and also explain this image", sourceTurnId: "original", images: [{ id: "image-id", data: "AQ==", mimeType: "image/png" }] },
    { role: "assistant", text: mixedAnswer, factsAsOf: context.factsAsOf },
  ] });
  expect(followup).toMatchObject({ kind: "conversation", reply: expect.stringContaining("1,244.33 CNY"), audit: { toolCalls: [] } });
  expect(searches).toBe(1);
});
