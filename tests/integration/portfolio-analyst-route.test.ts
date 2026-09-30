import { describe, expect, it } from "vitest";

import { createPortfolioAnalystHandlers } from "@/app/api/portfolio/analyst/handler";
import type {
  PortfolioAnalystConversation,
  PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystProvider } from "@/application/portfolio-analyst-provider";
import { PortfolioAnalystProviderError } from "@/application/portfolio-analyst-provider";
import type {
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";
import { draftPortfolioFromOpeningSnapshot } from "@/domain/imports";

function portfolio(): PortfolioOverviewReadModel & { insights: PortfolioInsightsReadModel } {
  const performance = {
    available: true,
    change: 10,
    percent: 11.11,
    points: [90, 100],
    priceChange: 8,
    fxChange: 2,
    baselineAsOf: "2026-09-01",
    currentAsOf: "2026-09-08",
  };
  return {
    holdings: [{
      id: "private-account:private-instrument",
      sourceAccountId: "private-account",
      holdingKey: {
        sourceAccountId: "private-account",
        instrumentId: "private-instrument",
      },
      name: "Synthetic Fund",
      analystDisplayName: "Synthetic Fund",
      symbol: "PRIVATE-ISIN",
      source: "Private Account",
      category: "Fund",
      currency: "EUR",
      originalValue: "EUR 100",
      eurValue: 100,
      changeEur: 10,
      changePercent: 11.11,
      freshness: "fresh",
      asOf: "2026-09-08",
      detail: {
        quantity: "private quantity",
        costBasis: "private cost basis",
        reportedPriorReturn: "private return",
        currentPrice: "private price",
        currentPriceAsOf: "2026-09-08",
        priceHistory: [],
      },
      history: {
        today: performance,
        week: performance,
        month: performance,
      },
    }],
    totalValueEur: 100,
    accountAllocation: [],
    fxAsOf: "2026-09-08",
    missingInputs: [],
    marketData: { refreshHistory: [] },
    history: {
      today: performance,
      week: performance,
      month: performance,
    },
    insights: {
      asOf: "2026-09-08T10:00:00.000Z",
      summary: {
        investmentPositionCount: 1,
        sourceAccountCount: 1,
        topThreeSharePercent: 100,
      },
      holdingCurrencyAllocation: [],
      categoryAllocation: [],
      performance: {
        today: { available: true, changeEur: 10, percent: 11.11, priceChangeEur: 8, fxChangeEur: 2 },
        week: { available: true, changeEur: 10, percent: 11.11, priceChangeEur: 8, fxChangeEur: 2 },
        month: { available: true, changeEur: 10, percent: 11.11, priceChangeEur: 8, fxChangeEur: 2 },
      },
      dataQuality: {
        valuedHoldingCount: 1,
        freshCount: 1,
        manualCount: 0,
        staleCount: 0,
        awaitingNavCount: 0,
        missingInputCount: 0,
        availablePerformancePeriods: ["today", "week", "month"],
      },
    },
  };
}

function provider(
  generate?: PortfolioAnalystProvider["generate"],
): PortfolioAnalystProvider {
  return {
    id: "openai",
    model: "gpt-synthetic",
    generate: generate ?? (async (context) => ({
      factsAsOf: context.factsAsOf,
      answer: {
        text: "Synthetic factual answer.",
        classification: "fact",
        evidence: [context.job === "explain-period-drivers"
          ? "period.total"
          : "quality.summary"],
      },
      claims: [],
      limitations: context.limitations,
      proposedUpdate: null,
    })),
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/portfolio/analyst", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function conversationStore(): PortfolioAnalystConversationStore {
  const conversations = new Map<string, PortfolioAnalystConversation>();
  return {
    readLatestPortfolioAnalystConversation: () => [...conversations.values()].at(-1),
    readPortfolioAnalystConversation: (id) => conversations.get(id),
    savePortfolioAnalystConversation: (conversation) => {
      conversations.delete(conversation.id);
      conversations.set(conversation.id, conversation);
    },
    deletePortfolioAnalystConversation: (id) => { conversations.delete(id); },
  };
}

describe("/api/portfolio/analyst", () => {
  it("binds an import draft to the conversation and restores it on GET", async () => {
    const store = conversationStore();
    store.savePortfolioAnalystConversation({
      version: "portfolio-analyst-conversation.v1",
      id: "conversation-import",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: true,
      createdAt: "2026-09-22T20:00:00.000Z",
      updatedAt: "2026-09-22T20:00:00.000Z",
      turns: [],
    });
    const storedDraft = {
      id: "draft-wechat",
      sourceAccountId: "wechat-main",
      sourceKind: "screenshot" as const,
      createdAt: "2026-09-22T20:01:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-wechat",
        sourceAccountId: "wechat-main",
        asOf: "2026-09-22T00:00:00.000Z",
        positions: [{
          instrumentId: "SYNTH-FUND-1",
          quantity: "1",
          currency: "CNY",
          costBasis: "1",
        }],
      }, "vision"),
      status: "draft" as const,
    };
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider() },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      getImportDraft: (id) => id === storedDraft.id ? storedDraft : undefined,
      now: () => "2026-09-22T20:02:00.000Z",
    });

    const patched = await handlers.PATCH(new Request("http://localhost/api/portfolio/analyst", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "conversation-import",
        draftId: "draft-wechat",
        targetLabel: "WeChat",
        submissionText: "帮我识别一下",
        screenshotCount: 1,
      }),
    }));

    expect(patched.status).toBe(200);
    await expect(handlers.GET().then((response) => response.json())).resolves.toMatchObject({
      conversation: {
        importActivity: {
          draftId: "draft-wechat",
          targetLabel: "WeChat",
          screenshotCount: 1,
        },
      },
      importDraft: { id: "draft-wechat", status: "draft" },
    });
  });

  it("uses the model-controlled runtime tool choice and persists its safe audit", async () => {
    const store = conversationStore();
    const events: unknown[] = [];
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider() },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
      agentRuntimes: {
        openai: {
          async runTurn(input) {
            input.onToolActivity?.({
              stage: "started",
              toolCallId: "tool-1",
              name: "read_data_quality",
              input: {},
            });
            const selected = input.tools.readDataQuality({
              language: input.language,
              includeHoldingNames: input.includeHoldingNames,
            });
            input.onToolActivity?.({
              stage: "completed",
              toolCallId: "tool-1",
              name: "read_data_quality",
              input: {},
              factsAsOf: selected.factsAsOf,
              evidenceCount: selected.facts.length,
            });
            return {
              context: selected,
              answer: await provider().generate(selected),
              audit: {
                runtime: "pi-agent-core",
                modelTurns: 2,
                stopReason: "completed",
                toolCalls: [{
                  toolCallId: "tool-1",
                  name: "read_data_quality",
                  input: {},
                  status: "completed",
                  factsAsOf: selected.factsAsOf,
                  evidenceKeys: selected.facts.map((fact) => fact.key),
                }],
              },
            };
          },
        },
      },
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      createId: (() => {
        const ids = ["agent-conversation", "agent-turn"];
        return () => ids.shift()!;
      })(),
    });

    const response = await handlers.POST(request({
      provider: "openai",
      mode: "agent",
      defaultPeriod: "week",
      language: "en",
      includeHoldingNames: false,
      question: "Is my data current?",
    }), (event) => events.push(event));

    expect(response.status).toBe(200);
    const saved = store.readLatestPortfolioAnalystConversation();
    expect(saved?.turns[0]?.report).toMatchObject({
      job: "diagnose-data-quality",
      agentAudit: {
        runtime: "pi-agent-core",
        modelTurns: 2,
        stopReason: "completed",
        toolCalls: [{ name: "read_data_quality", status: "completed" }],
      },
    });
    expect(events.slice(0, 2)).toEqual([
      { type: "accepted", question: "Is my data current?" },
      { type: "status", phase: "selecting-tool" },
    ]);
    expect(events).toContainEqual({
      type: "tool-activity",
      activity: {
        stage: "started",
        toolCallId: "tool-1",
        name: "read_data_quality",
        input: {},
      },
    });
    expect(events).toContainEqual({
      type: "tool-activity",
      activity: {
        stage: "completed",
        toolCallId: "tool-1",
        name: "read_data_quality",
        input: {},
        factsAsOf: "2026-09-08T10:00:00.000Z",
        evidenceCount: 1,
      },
    });
  });

  it("directly calls the period tool, then returns only cited evidence", async () => {
    let received: PortfolioAnalystContextV1 | undefined;
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async (context) => {
        received = context;
        return provider().generate(context);
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      now: () => "2026-09-08T10:05:00.000Z",
    });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "explain-period-drivers",
      period: "week",
      language: "en",
      includeHoldingNames: true,
    }));

    expect(response.status).toBe(200);
    await expect(handlers.GET().then((item) => item.json())).resolves.toEqual({
      defaultProvider: "openai",
      providers: [
        { id: "openai", configured: true, model: "gpt-synthetic" },
        { id: "deepseek", configured: false, model: "deepseek-synthetic" },
      ],
    });
    expect(received).toMatchObject({
      job: "explain-period-drivers",
      scope: { period: "week" },
    });
    expect(JSON.stringify(received)).not.toMatch(
      /private-account|private-instrument|PRIVATE-ISIN|private cost basis/,
    );
    await expect(response.json()).resolves.toEqual({
      result: expect.objectContaining({
        provider: "openai",
        model: "gpt-synthetic",
        generatedAt: "2026-09-08T10:05:00.000Z",
        job: "explain-period-drivers",
        factsAsOf: "2026-09-08T10:00:00.000Z",
        answer: expect.objectContaining({
          answer: expect.objectContaining({ evidence: ["period.total"] }),
        }),
        evidence: [expect.objectContaining({ key: "period.total" })],
      }),
    });
  });

  it("directly calls the data-quality tool and honors disabled holding names", async () => {
    let received: PortfolioAnalystContextV1 | undefined;
    const value = portfolio();
    value.holdings[0]!.freshness = "stale";
    value.insights.dataQuality.freshCount = 0;
    value.insights.dataQuality.staleCount = 1;
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async (context) => {
        received = context;
        return provider().generate(context);
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: () => value });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "zh-CN",
      includeHoldingNames: false,
    }));

    expect(response.status).toBe(200);
    expect(received?.job).toBe("diagnose-data-quality");
    expect(JSON.stringify(received)).not.toContain("Synthetic Fund");
  });

  it("rejects invalid input, missing facts and an unconfigured provider before generation", async () => {
    let calls = 0;
    const fake = provider(async (context) => {
      calls += 1;
      return provider().generate(context);
    });
    const configured = createPortfolioAnalystHandlers({
      providers: { openai: fake },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: () => undefined });

    expect((await configured.POST(request({
      provider: "openai",
      job: "explain-period-drivers",
      language: "en",
      includeHoldingNames: true,
    }))).status).toBe(400);
    expect((await configured.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: true,
    }))).status).toBe(409);

    const unconfigured = createPortfolioAnalystHandlers({
      providers: {},
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: portfolio });
    expect((await unconfigured.POST(request({
      provider: "deepseek",
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: true,
    }))).status).toBe(503);
    expect(calls).toBe(0);
  });

  it("returns a safe code when provider output fails semantic validation", async () => {
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async () => {
        throw new PortfolioAnalystProviderError(
          "invalid-provider-output",
          "OpenAI",
        );
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: portfolio });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: true,
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI returned an invalid portfolio analyst answer.",
      code: "invalid-provider-output",
    });
  });

  it("persists a conversation and supplies bounded history to a follow-up", async () => {
    const store = conversationStore();
    const receivedHistory: unknown[] = [];
    const fake = provider(async (context, turn) => {
      receivedHistory.push(turn?.history);
      return provider().generate(context);
    });
    const ids = ["conversation-1", "turn-1", "turn-2"];
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: fake },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      createId: () => ids.shift()!,
      now: () => "2026-09-09T10:05:00.000Z",
    });

    const first = await handlers.POST(request({
      provider: "openai",
      job: "explain-period-drivers",
      period: "week",
      language: "zh-CN",
      includeHoldingNames: true,
      question: "本周为什么上涨？",
    }));
    const firstBody = await first.json() as { conversation: PortfolioAnalystConversation };
    expect(firstBody.conversation.id).toBe("conversation-1");
    expect(firstBody.conversation.turns).toHaveLength(1);

    const second = await handlers.POST(request({
      provider: "openai",
      conversationId: "conversation-1",
      job: "explain-period-drivers",
      period: "week",
      language: "zh-CN",
      includeHoldingNames: true,
      question: "为什么 FX 是正的？",
    }));
    expect(second.status).toBe(200);
    expect(receivedHistory).toEqual([
      [],
      [
        { role: "user", text: "本周为什么上涨？" },
        {
          role: "assistant",
          text: "Synthetic factual answer.",
          factsAsOf: "2026-09-08T10:00:00.000Z",
        },
      ],
    ]);
    await expect(handlers.GET().then((response) => response.json())).resolves.toMatchObject({
      conversation: { id: "conversation-1", turns: [{}, {}] },
    });

    const deleted = await handlers.DELETE(new Request("http://localhost/api/portfolio/analyst", {
      method: "DELETE",
      body: JSON.stringify({ conversationId: "conversation-1" }),
    }));
    expect(deleted.status).toBe(200);
    expect(store.readLatestPortfolioAnalystConversation()).toBeUndefined();
  });

  it("requires a reset before conversation privacy settings become stricter", async () => {
    const store = conversationStore();
    store.savePortfolioAnalystConversation({
      version: "portfolio-analyst-conversation.v1",
      id: "conversation-1",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: true,
      createdAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T10:00:00.000Z",
      turns: [],
    });
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider() },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: portfolio, conversations: store });

    const response = await handlers.POST(request({
      provider: "openai",
      conversationId: "conversation-1",
      job: "diagnose-data-quality",
      language: "zh-CN",
      includeHoldingNames: false,
      question: "数据可靠吗？",
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "conversation-settings-mismatch",
    });
  });

  it("emits an optimistic lifecycle and provider text deltas before completion", async () => {
    const events: unknown[] = [];
    const store = conversationStore();
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async (context, turn) => {
        turn?.onAnswerTextDelta?.("Synthetic ");
        turn?.onAnswerTextDelta?.("factual answer.");
        return provider().generate(context);
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      createId: (() => {
        const ids = ["conversation-stream", "turn-stream"];
        return () => ids.shift()!;
      })(),
    });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "explain-period-drivers",
      period: "week",
      language: "en",
      includeHoldingNames: false,
      question: "What changed?",
    }), (event) => events.push(event));

    expect(response.status).toBe(200);
    expect(events).toEqual([
      { type: "accepted", question: "What changed?" },
      { type: "status", phase: "reading-current-facts" },
      { type: "status", phase: "generating-answer" },
      { type: "answer-delta", delta: "Synthetic " },
      { type: "answer-delta", delta: "factual answer." },
    ]);
  });

  it("does not persist provisional output when provider validation fails", async () => {
    const store = conversationStore();
    const events: unknown[] = [];
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async (_context, turn) => {
        turn?.onAnswerTextDelta?.("Unvalidated partial text");
        throw new PortfolioAnalystProviderError("invalid-provider-output", "OpenAI");
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
    });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: false,
      question: "Is the data current?",
    }), (event) => events.push(event));

    expect(response.status).toBe(502);
    expect(events).toContainEqual({
      type: "answer-delta",
      delta: "Unvalidated partial text",
    });
    expect(store.readLatestPortfolioAnalystConversation()).toBeUndefined();
  });
});
