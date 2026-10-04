import { describe, expect, it } from "vitest";

import { createPortfolioAnalystHandlers } from "@/app/api/portfolio/analyst/handler";
import type {
  PortfolioAnalystConversation,
  PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystAgentRuntime, PortfolioAnalystAgentTurn } from "@/application/portfolio-analyst-agent";
import { PortfolioAnalystProviderError } from "@/application/portfolio-analyst-provider";
import type {
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";
import { draftPortfolioFromOpeningSnapshot, type StoredImportDraft } from "@/domain/imports";

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
        currentPriceSource: "synthetic-source",
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

function answer(context: PortfolioAnalystContextV1): PortfolioAnalystAnswer {
  return {
    factsAsOf: context.factsAsOf,
    answer: {
      text: "Synthetic factual answer.",
      classification: "fact",
      evidence: [context.job === "explain-period-drivers" ? "period.total" : "quality.summary"],
    },
    claims: [],
    limitations: context.limitations,
    proposedUpdate: null,
  };
}

function runtime(
  generate?: (context: PortfolioAnalystContextV1, turn: PortfolioAnalystAgentTurn) => Promise<PortfolioAnalystAnswer>,
  selectedTool: "period" | "quality" = "quality",
): PortfolioAnalystAgentRuntime {
  return {
    async runTurn(input) {
      const context = selectedTool === "period"
        ? input.tools.readPeriodDrivers({
            period: input.defaultPeriod,
            language: input.language,
            includeHoldingNames: input.includeHoldingNames,
          })
        : input.tools.readDataQuality({
            language: input.language,
            includeHoldingNames: input.includeHoldingNames,
          });
      return {
        kind: "report",
        context,
        answer: generate ? await generate(context, input) : answer(context),
        audit: { runtime: "pi-agent-core", modelTurns: 1, stopReason: "completed", toolCalls: [] },
      };
    },
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
  it.each(["thanks", "Thank you"])(
    "finishes %s after a cancelled import without requiring a portfolio tool",
    async (question) => {
    const store = conversationStore();
    store.savePortfolioAnalystConversation({
      version: "portfolio-analyst-conversation.v1",
      id: "cancelled-import-conversation",
      provider: "openai",
      language: "en",
      includeHoldingNames: true,
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:03:00.000Z",
      turns: [],
      importActivities: [{
        draftId: "discarded-draft",
        targetLabel: "Synthetic Account",
        submissionText: "Import this image",
        screenshotCount: 1,
        createdAt: "2026-10-01T10:01:00.000Z",
        cancelledAt: "2026-10-01T10:03:00.000Z",
        followUps: [{
          id: "cancel-message",
          userText: "cancel import",
          assistantText: "I cancelled this import and removed its unconfirmed draft. Your holdings were not changed.",
          createdAt: "2026-10-01T10:03:00.000Z",
        }],
      }],
    });
    let runtimeCalled = false;
    let receivedHistory: unknown;
    const handlers = createPortfolioAnalystHandlers({
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
      agentRuntimes: { openai: { async runTurn(input) {
        runtimeCalled = true;
        receivedHistory = input.history;
        return {
          kind: "conversation" as const,
          reply: "You're welcome. What would you like to discuss next?",
          audit: { runtime: "pi-agent-core" as const, modelTurns: 1, stopReason: "completed" as const, toolCalls: [] },
        };
      } } },
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      now: () => "2026-10-01T10:04:00.000Z",
      createId: () => "courtesy-turn",
    });

    const response = await handlers.POST(request({
      provider: "openai",
      mode: "agent",
      defaultPeriod: "week",
      language: "en",
      includeHoldingNames: true,
      conversationId: "cancelled-import-conversation",
      question,
    }));

    expect(response.status).toBe(200);
    expect(runtimeCalled).toBe(true);
    expect(receivedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", text: "cancel import" }),
    ]));
    expect(store.readLatestPortfolioAnalystConversation()?.turns.at(-1)).toMatchObject({
      id: "courtesy-turn",
      question,
      chat: { assistantText: "You're welcome. What would you like to discuss next?" },
    });
    },
  );

  it("persists a no-evidence dialogue result as a chat turn", async () => {
    const store = conversationStore();
    const handlers = createPortfolioAnalystHandlers({
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
      agentRuntimes: { openai: { async runTurn() {
        return {
          kind: "conversation" as const,
          reply: "Hi! What would you like to know about your portfolio or accounts?",
          audit: { runtime: "pi-agent-core" as const, modelTurns: 1, stopReason: "completed" as const, toolCalls: [] },
        };
      } } },
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      now: () => "2026-10-01T10:04:00.000Z",
      createId: (() => {
        const ids = ["dialogue-conversation", "dialogue-turn"];
        return () => ids.shift()!;
      })(),
    });

    const response = await handlers.POST(request({
      provider: "openai",
      mode: "agent",
      defaultPeriod: "week",
      language: "en",
      includeHoldingNames: false,
      question: "Hello",
    }));

    expect(response.status).toBe(200);
    expect(store.readLatestPortfolioAnalystConversation()?.turns).toMatchObject([{
      id: "dialogue-turn",
      question: "Hello",
      chat: { assistantText: "Hi! What would you like to know about your portfolio or accounts?" },
    }]);
  });

  it("loads configuration when a hot-reload repository returns the previous conversation shape", async () => {
    const store = conversationStore();
    store.savePortfolioAnalystConversation({
      version: "portfolio-analyst-conversation.v1",
      id: "legacy-live-conversation",
      provider: "openai",
      language: "zh-CN",
      includeHoldingNames: true,
      createdAt: "2026-09-22T20:00:00.000Z",
      updatedAt: "2026-09-22T20:00:00.000Z",
      turns: [],
      importActivity: {
        draftId: "old-draft",
        targetLabel: "WeChat",
        submissionText: "识别截图",
        screenshotCount: 1,
        createdAt: "2026-09-22T20:01:00.000Z",
      },
    } as unknown as PortfolioAnalystConversation);
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: {},
      models: { openai: "synthetic", deepseek: "synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: portfolio, conversations: store });

    const response = await handlers.GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      conversation: { importActivities: [{ draftId: "old-draft" }] },
    });
  });

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
      importActivities: [],
    });
    const storedDraft: StoredImportDraft = {
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
      agentRuntimes: { openai: runtime() },
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
        importActivities: [{
          draftId: "draft-wechat",
          targetLabel: "WeChat",
          screenshotCount: 1,
        }],
      },
      importDrafts: [{ id: "draft-wechat", status: "draft" }],
    });


  });

  it("uses the model-controlled runtime tool choice and persists its safe audit", async () => {
    const store = conversationStore();
    const events: unknown[] = [];
    let runtimeQuestion = "";
    const handlers = createPortfolioAnalystHandlers({
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
      agentRuntimes: {
        openai: {
          async runTurn(input) {
            runtimeQuestion = input.question;
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
              kind: "report",
              context: selected,
              answer: await answer(selected),
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
      screenshotCount: 1,
    }), (event) => events.push(event));

    expect(response.status).toBe(200);
    expect(runtimeQuestion).toContain("image contents are not visible");
    expect(runtimeQuestion).toContain("prepare_account_import");
    const saved = store.readLatestPortfolioAnalystConversation();
    expect(saved?.turns[0]?.question).toBe("Is my data current?");
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

  it("returns only cited evidence from the runtime-selected period tool", async () => {
    let received: PortfolioAnalystContextV1 | undefined;
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: runtime(async (context) => {
        received = context;
        return answer(context);
      }, "period") },
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

  it("honors disabled holding names in runtime-selected data-quality evidence", async () => {
    let received: PortfolioAnalystContextV1 | undefined;
    const value = portfolio();
    value.holdings[0]!.freshness = "stale";
    value.insights.dataQuality.freshCount = 0;
    value.insights.dataQuality.staleCount = 1;
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: runtime(async (context) => {
        received = context;
        return answer(context);
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
    const fake = runtime(async (context) => {
      calls += 1;
      return answer(context);
    });
    const configured = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: fake },
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
      agentRuntimes: {},
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
      agentRuntimes: { openai: runtime(async () => {
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
    const receivedMemory: unknown[] = [];
    let savedMemory = "Keep answers brief.";
    const deletedImageIds: string[] = [];
    const fake = runtime(async (context, turn) => {
      receivedHistory.push(turn.history);
      receivedMemory.push(turn.memories);
      return answer(context);
    }, "period");
    const ids = ["conversation-1", "turn-1", "turn-2"];
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: fake },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      memory: {
        listPortfolioAnalystMemories: () => savedMemory ? [{
          id: "memory-1", content: savedMemory, source: "chat",
          createdAt: "2026-09-09T10:00:00.000Z", updatedAt: "2026-09-09T10:00:00.000Z",
        }] : [],
        readPortfolioAnalystMemory: () => undefined,
        savePortfolioAnalystMemory: (memory) => { savedMemory = memory.content; },
        deletePortfolioAnalystMemory: () => { savedMemory = ""; },
      },
      deleteImage: async (attachment) => { deletedImageIds.push(attachment.id); },
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

    savedMemory = "";

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
    expect(receivedMemory).toMatchObject([[{ content: "Keep answers brief." }], []]);
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
    const saved = store.readPortfolioAnalystConversation("conversation-1")!;
    store.savePortfolioAnalystConversation({
      ...saved,
      turns: saved.turns.map((turn, index) => index === 0
        ? { ...turn, attachments: [{
            id: "11111111-1111-4111-8111-111111111111" as const,
            mimeType: "image/png" as const, byteLength: 3,
          }] }
        : turn),
    });

    const deleted = await handlers.DELETE(new Request("http://localhost/api/portfolio/analyst", {
      method: "DELETE",
      body: JSON.stringify({ conversationId: "conversation-1" }),
    }));
    expect(deleted.status).toBe(200);
    expect(store.readLatestPortfolioAnalystConversation()).toBeUndefined();
    expect(deletedImageIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("keeps a memory request as a chat turn and excludes it from model history", async () => {
    const store = conversationStore();
    const ids = ["memory-conversation", "memory-turn", "answer-turn"];
    const histories: unknown[] = [];
    const fake = runtime(async (context, turn) => {
      histories.push(turn.history);
      return answer(context);
    });
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: {
        ...fake,
        generateMemoryProposal: async () => ({ kind: "preference" as const, content: "Answer briefly." }),
      } },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio, conversations: store,
      createId: () => ids.shift()!, now: () => "2026-10-04T10:00:00.000Z",
    });
    const first = await handlers.POST(request({
      mode: "agent", provider: "openai", language: "en", includeHoldingNames: true,
      defaultPeriod: "week", question: "Remember: Keep my answers brief.",
    }));
    const firstBody = await first.json() as { conversation: PortfolioAnalystConversation };
    expect(firstBody.conversation.turns[0]).toMatchObject({
      id: "memory-turn", question: "Remember: Keep my answers brief.",
      chat: { memoryProposal: { content: "Answer briefly.", status: "pending" } },
    });
    expect(store.readLatestPortfolioAnalystConversation()?.turns).toHaveLength(1);
    expect(histories).toEqual([]);

    await handlers.POST(request({
      mode: "agent", provider: "openai", language: "en", includeHoldingNames: true,
      defaultPeriod: "week", conversationId: "memory-conversation", question: "What changed today?",
    }));
    expect(histories).toEqual([[]]);
    expect(store.readLatestPortfolioAnalystConversation()?.turns).toHaveLength(2);
  });

  it("keeps a memory request when generation fails and does not offer raw text for saving", async () => {
    const store = conversationStore();
    const ids = ["memory-conversation", "memory-turn"];
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: {
        ...runtime(),
        generateMemoryProposal: async () => {
          throw new PortfolioAnalystProviderError("provider-unavailable", "OpenAI", "timeout");
        },
      } },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio, conversations: store,
      createId: () => ids.shift()!, now: () => "2026-10-04T10:00:00.000Z",
    });
    const response = await handlers.POST(request({
      mode: "agent", provider: "openai", language: "en", includeHoldingNames: true,
      defaultPeriod: "week", question: "Remember to answer me shortly",
    }));
    expect(response.status).toBe(200);
    expect(store.readLatestPortfolioAnalystConversation()?.turns).toMatchObject([{
      question: "Remember to answer me shortly",
      chat: { failureCode: "provider-unavailable", failureDetail: "timeout" },
    }]);
    expect(store.readLatestPortfolioAnalystConversation()?.turns[0].chat?.memoryProposal).toBeUndefined();
  });

  it("keeps a duplicate request in chat without creating a second memory proposal", async () => {
    const store = conversationStore();
    const ids = ["memory-conversation", "memory-turn"];
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: {
        ...runtime(), generateMemoryProposal: async () => ({ kind: "duplicate" as const }),
      } },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio, conversations: store,
      createId: () => ids.shift()!, now: () => "2026-10-04T10:00:00.000Z",
    });
    const response = await handlers.POST(request({
      mode: "agent", provider: "openai", language: "en", includeHoldingNames: true,
      defaultPeriod: "week", question: "Remember to answer me shortly",
    }));
    expect(response.status).toBe(200);
    expect(store.readLatestPortfolioAnalystConversation()?.turns[0]).toMatchObject({
      question: "Remember to answer me shortly",
      chat: { assistantText: "A similar memory is already saved, so I did not add another one." },
    });
    expect(store.readLatestPortfolioAnalystConversation()?.turns[0].chat?.memoryProposal).toBeUndefined();
  });

  it("keeps a failed question when a later question is sent", async () => {
    const store = conversationStore();
    const ids = ["failure-conversation", "failed-turn", "later-turn"];
    let calls = 0;
    const histories: unknown[] = [];
    const working = runtime(async (context, turn) => {
      histories.push(turn.history);
      return answer(context);
    });
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: {
        runTurn(input) {
          if (++calls === 1) throw new PortfolioAnalystProviderError("invalid-provider-output", "OpenAI", "unknown-evidence");
          return working.runTurn(input);
        },
      } },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio, conversations: store,
      createId: () => ids.shift()!, now: () => "2026-10-04T10:00:00.000Z",
    });
    const first = await handlers.POST(request({
      mode: "agent", provider: "openai", language: "en", includeHoldingNames: true,
      defaultPeriod: "week", question: "Latest NASDAQ news?",
    }));
    expect(first.status).toBe(200);
    expect((await first.json()).conversation.turns[0]).toMatchObject({
      question: "Latest NASDAQ news?", chat: {
        failureCode: "invalid-provider-output", failureDetail: "unknown-evidence",
      },
    });
    await handlers.POST(request({
      mode: "agent", provider: "openai", language: "en", includeHoldingNames: true,
      defaultPeriod: "week", conversationId: "failure-conversation", question: "How is my portfolio?",
    }));
    expect(store.readLatestPortfolioAnalystConversation()?.turns.map((turn) => turn.question))
      .toEqual(["Latest NASDAQ news?", "How is my portfolio?"]);
    expect(histories).toEqual([[]]);
  });

  it("stores a question before model work and replaces its pending turn when finished", async () => {
    const store = conversationStore();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredRuntime = new Promise<void>((resolve) => { entered = resolve; });
    const working = runtime();
    const ids = ["pending-conversation", "pending-turn"];
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: { async runTurn(input) {
        entered();
        await waiting;
        return working.runTurn(input);
      } } },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio, conversations: store,
      createId: () => ids.shift()!, now: () => "2026-10-04T10:00:00.000Z",
    });
    const responsePromise = handlers.POST(request({
      mode: "agent", provider: "openai", language: "en", includeHoldingNames: true,
      defaultPeriod: "week", question: "What changed?",
    }));
    await enteredRuntime;
    expect(store.readLatestPortfolioAnalystConversation()?.turns).toMatchObject([{
      id: "pending-turn", question: "What changed?", chat: { requestStatus: "pending" },
    }]);
    release();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(store.readLatestPortfolioAnalystConversation()?.turns).toMatchObject([{
      id: "pending-turn", question: "What changed?", report: { provider: "openai" },
    }]);
    expect(store.readLatestPortfolioAnalystConversation()?.turns).toHaveLength(1);
  });

  it("passes recent chat and import replies to an ordinary follow-up", async () => {
    const store = conversationStore();
    let receivedHistory: unknown;
    store.savePortfolioAnalystConversation({
      version: "portfolio-analyst-conversation.v1",
      id: "mixed-conversation",
      provider: "openai",
      language: "en",
      includeHoldingNames: true,
      createdAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T10:02:00.000Z",
      turns: [{
        id: "chat-1", question: "Use the synthetic account.",
        createdAt: "2026-09-09T10:01:00.000Z",
        chat: { assistantText: "I found the synthetic account." },
      }],
      importActivities: [{
        draftId: "draft-1", targetLabel: "Synthetic Account",
        submissionText: "Import", screenshotCount: 1,
        createdAt: "2026-09-09T10:01:30.000Z",
        followUps: [{
          id: "follow-1", userText: "Cancel that draft.",
          assistantText: "The draft was cancelled.",
          createdAt: "2026-09-09T10:02:00.000Z",
        }],
      }],
    });
    const fake = runtime(async (context, turn) => {
      receivedHistory = turn.history;
      return answer(context);
    });
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: fake },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      conversations: store,
      createId: () => "follow-up-1",
      now: () => "2026-09-09T10:03:00.000Z",
    });

    const response = await handlers.POST(request({
      provider: "openai", conversationId: "mixed-conversation",
      mode: "agent", defaultPeriod: "week", language: "en",
      includeHoldingNames: true, question: "What does that account hold now?",
    }));

    expect(response.status).toBe(200);
    expect(receivedHistory).toEqual([
      { role: "user", text: "Use the synthetic account." },
      { role: "assistant", text: "I found the synthetic account.", factsAsOf: "2026-09-09T10:01:00.000Z" },
      { role: "user", text: "Cancel that draft." },
      { role: "assistant", text: "The draft was cancelled.", factsAsOf: "2026-09-09T10:02:00.000Z" },
    ]);
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
      importActivities: [],
    });
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: runtime() },
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

  it("continues an existing conversation in English without deleting its history", async () => {
    const store = conversationStore();
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: runtime() },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: portfolio, conversations: store });
    const first = await handlers.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "zh-CN",
      includeHoldingNames: true,
      question: "组合数据是否最新？",
    }));
    expect(first.status).toBe(200);
    const firstPayload = await first.json() as { conversation: PortfolioAnalystConversation };

    const response = await handlers.POST(request({
      provider: "openai",
      conversationId: firstPayload.conversation.id,
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: true,
      question: "How current is my portfolio?",
    }));
    expect(response.status).toBe(200);
    expect(store.readPortfolioAnalystConversation(firstPayload.conversation.id))
      .toMatchObject({ language: "en", turns: [
        { question: "组合数据是否最新？", report: { language: "zh-CN" } },
        { question: "How current is my portfolio?", report: { language: "en" } },
      ] });
  });

  it("emits runtime selection and answer text deltas before completion", async () => {
    const events: unknown[] = [];
    const store = conversationStore();
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: runtime(async (context, turn) => {
        turn.onAnswerTextDelta?.("Synthetic ");
        turn.onAnswerTextDelta?.("factual answer.");
        return answer(context);
      }, "period") },
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
      { type: "status", phase: "selecting-tool" },
      { type: "answer-delta", delta: "Synthetic " },
      { type: "answer-delta", delta: "factual answer." },
    ]);
  });

  it("does not persist provisional output when provider validation fails", async () => {
    const store = conversationStore();
    const events: unknown[] = [];
    const handlers = createPortfolioAnalystHandlers({
      agentRuntimes: { openai: runtime(async (_context, turn) => {
        turn.onAnswerTextDelta?.("Unvalidated partial text");
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
