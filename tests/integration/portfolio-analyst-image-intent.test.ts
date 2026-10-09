import { describe, expect, it } from "vitest";

import { createAgentImageIntentHandler } from "@/app/api/portfolio/analyst/images/intent/handler";
import {
  createPortfolioAnalystConversation,
  appendPortfolioAnalystTurn,
  type PortfolioAnalystConversation,
  type PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";
import { createSourceAccountDefinition } from "@/domain/source-accounts";

const imageId = "image-turn";
const replyId = "14a41919-4922-4cd4-8748-9d23d8077157";

function request(body: unknown) {
  return new Request("http://localhost/api/portfolio/analyst/images/intent", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function fixture(text = "处理这张图") {
  let current: PortfolioAnalystConversation | undefined = appendPortfolioAnalystTurn(
    createPortfolioAnalystConversation({
      id: "conversation", provider: "openai", language: "zh-CN",
      includeHoldingNames: true, now: "2026-10-03T00:00:00.000Z",
    }),
    {
      id: imageId, question: text, userText: text, createdAt: "2026-10-03T00:00:01.000Z",
      attachments: [{ id: "attachment", mimeType: "image/png", byteLength: 100 }],
      chat: { assistantText: "", imageAction: { sourceTurnId: imageId, stage: "intent" } },
    },
  );
  const conversations: PortfolioAnalystConversationStore = {
    readLatestPortfolioAnalystConversation: () => current,
    readPortfolioAnalystConversation: (id) => id === current?.id ? current : undefined,
    savePortfolioAnalystConversation: (value) => { current = value; },
    deletePortfolioAnalystConversation: () => { current = undefined; },
  };
  const accounts = [
    createSourceAccountDefinition({ id: "first", accountType: "Alipay", label: "支付宝" }),
    createSourceAccountDefinition({ id: "second", accountType: "Danske Bank", label: "Danske" }),
    createSourceAccountDefinition({ id: "wechat", accountType: "WeChat", label: "微信" }),
    createSourceAccountDefinition({ id: "wechat-cn", accountType: "微信", label: "微信账户" }),
  ];
  return { conversations, accounts, read: () => current! };
}

describe("assistant image conversation", () => {
  it("stores clarification on the already sent image and continues with that image", async () => {
    const state = fixture();
    const handler = createAgentImageIntentHandler({
      ...state, readAccounts: () => state.accounts, imageModel: "test-model",
      interpret: async ({ text }) => text === "处理这张图"
        ? { intent: "clarify", confidence: "low" }
        : { intent: "answer-image", confidence: "high" },
    });
    const first = await handler(request({ conversationId: "conversation", sourceTurnId: imageId }));
    expect(first.status).toBe(200);
    expect(state.read().turns[0].attachments).toHaveLength(1);
    expect(state.read().turns[0].chat?.assistantText).toContain("解释图片");

    const second = await handler(request({
      conversationId: "conversation", sourceTurnId: imageId, id: replyId, text: "解释这张图",
    }));
    expect(second.status).toBe(200);
    const payload = await second.json();
    expect(payload.answerTurnId).toBe(replyId);
    expect(state.read().turns).toHaveLength(2);
    expect(state.read().turns[1].imageAnswer?.sourceTurnId).toBe(imageId);
    expect(state.read().turns[0].attachments?.[0].id).toBe("attachment");
  });

  it("asks for account in chat, then selects it without resending the image", async () => {
    const state = fixture("导入持仓");
    const handler = createAgentImageIntentHandler({
      ...state, readAccounts: () => state.accounts, imageModel: "test-model",
      interpret: async () => {
        return { intent: "prepare-import", confidence: "high", accountId: null };
      },
    });
    const first = await handler(request({ conversationId: "conversation", sourceTurnId: imageId }));
    expect((await first.json()).intent).toBe("clarify");
    expect(state.read().turns[0].chat?.assistantText).toContain("支付宝");
    expect(state.read().turns[0].chat?.imageAction?.stage).toBe("account");

    const second = await handler(request({
      conversationId: "conversation", sourceTurnId: imageId, id: replyId, text: "支付宝",
    }));
    const result = await second.json();
    expect(result).toMatchObject({ intent: "prepare-import", accountId: "first", sourceTurnId: imageId });
    expect(state.read().turns[1].userText).toBe("支付宝");
    expect(state.read().turns[0].attachments).toHaveLength(1);
    expect(state.read().importActivities).toHaveLength(0);
  });

  it("turns a direct image question into a pending answer with its attachment", async () => {
    const state = fixture("不要导入，解释截图");
    const handler = createAgentImageIntentHandler({
      ...state, readAccounts: () => state.accounts, imageModel: "test-model",
      interpret: async () => ({ intent: "answer-image", confidence: "high" }),
    });
    const response = await handler(request({ conversationId: "conversation", sourceTurnId: imageId }));
    expect((await response.json()).answerTurnId).toBe(imageId);
    expect(state.read().turns[0].imageAnswer?.status).toBe("pending");
    expect(state.read().turns[0].attachments).toHaveLength(1);
  });

  it("rejects a follow-up without a saved image action", async () => {
    const state = fixture();
    const handler = createAgentImageIntentHandler({
      ...state, readAccounts: () => state.accounts, imageModel: "test-model",
      interpret: async () => { throw new Error("Should not be called"); },
    });
    const response = await handler(request({ conversationId: "conversation", sourceTurnId: "other" }));
    expect(response.status).toBe(409);
  });

  it("starts import from a previously answered image without requesting another upload", async () => {
    const state = fixture("解释图片");
    state.conversations.savePortfolioAnalystConversation({
      ...state.read(),
      turns: [...state.read().turns, {
        id: "answered", question: "解释这张图", userText: "解释这张图",
        createdAt: "2026-10-03T00:00:02.000Z",
        imageAnswer: {
          status: "complete", text: "A synthetic account screenshot", uncertainties: [],
          provider: "openai", model: "test-model", generatedAt: "2026-10-03T00:00:03.000Z",
          sourceTurnId: imageId,
        },
      }],
    });
    const handler = createAgentImageIntentHandler({
      ...state, readAccounts: () => state.accounts, imageModel: "test-model",
      interpret: async ({ stage, text }) => {
        expect(stage).toBe("image-follow-up");
        expect(text).toBe("导入微信");
        return { intent: "prepare-import", confidence: "high", accountId: "wechat" };
      },
    });
    const response = await handler(request({
      conversationId: "conversation", sourceTurnId: imageId, id: replyId, text: "导入微信",
    }));
    expect((await response.json()).accountId).toBe("wechat");
    expect(state.read().turns.at(-1)?.chat?.assistantText).toContain("导入草稿");
    expect(state.read().turns[0].attachments).toHaveLength(1);
  });

  it("accepts assent to an import offer using the existing image", async () => {
    const state = fixture("处理图片");
    const report = {
      answer: { proposedUpdate: {
        kind: "start-account-import", accountType: "微信", label: "微信账户", reasonEvidenceKey: "account",
      } },
      evidence: [{ key: "account", kind: "source-account-import-target", updateMethod: "screenshot" }],
    };
    state.conversations.savePortfolioAnalystConversation({
      ...state.read(),
      turns: [...state.read().turns,
        { id: "answer", question: "解释", createdAt: "2026-10-03T00:00:02.000Z",
          imageAnswer: { status: "complete", text: "Synthetic", uncertainties: [], provider: "openai",
            model: "test-model", generatedAt: "2026-10-03T00:00:02.000Z", sourceTurnId: imageId } },
        { id: "offer", question: "导入", createdAt: "2026-10-03T00:00:03.000Z", report },
        { id: "repeat", question: "好的", createdAt: "2026-10-03T00:00:04.000Z", report },
      ] as PortfolioAnalystConversation["turns"],
    });
    const handler = createAgentImageIntentHandler({
      ...state, readAccounts: () => state.accounts, imageModel: "test-model",
      interpret: async () => { throw new Error("Clear assent does not need model routing."); },
    });
    const response = await handler(request({
      conversationId: "conversation", sourceTurnId: imageId, id: replyId, text: "好的",
    }));
    const payload = await response.json();
    expect(payload).toMatchObject({ intent: "prepare-import", accountId: "wechat-cn", sourceTurnId: imageId });
    expect(state.read().turns.at(-1)?.chat?.assistantText).toContain("导入草稿");
    expect(state.read().importActivities).toHaveLength(0);
  });

  it("passes an unrelated question to ordinary chat without mutating the image conversation", async () => {
    const state = fixture();
    state.conversations.savePortfolioAnalystConversation({
      ...state.read(),
      turns: [...state.read().turns, {
        id: "answer", question: "解释", createdAt: "2026-10-03T00:00:02.000Z",
        imageAnswer: { status: "complete", text: "Synthetic", uncertainties: [], provider: "openai",
          model: "test-model", generatedAt: "2026-10-03T00:00:02.000Z", sourceTurnId: imageId },
      }],
    });
    const handler = createAgentImageIntentHandler({
      ...state, readAccounts: () => state.accounts, imageModel: "test-model",
      interpret: async () => ({ intent: "delegate", confidence: "high", accountId: null }),
    });
    const response = await handler(request({
      conversationId: "conversation", sourceTurnId: imageId, id: replyId, text: "今天组合怎么样",
    }));
    expect((await response.json()).intent).toBe("delegate");
    expect(state.read().turns).toHaveLength(2);
  });
});

it("routes a sale screenshot to sale review instead of the holdings import", async () => {
  const state = fixture("帮我记录这笔卖出");
  const handler = createAgentImageIntentHandler({
    ...state, readAccounts: () => state.accounts, imageModel: "test-model",
    interpret: async () => ({ intent: "prepare-sale", confidence: "high" }),
  });
  const response = await handler(request({ conversationId: "conversation", sourceTurnId: imageId }));
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.intent).toBe("prepare-sale");
  expect(payload.conversation.turns.at(-1).chat.imageAction.purpose).toBe("sale");
  expect(payload.conversation.importActivities).toEqual([]);
});
