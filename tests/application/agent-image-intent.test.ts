import { describe, expect, it } from "vitest";

import { pendingScreenshotImportTarget, resumableImageContext } from "@/application/agent-image-intent";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";

describe("image message intent", () => {
  it("restores an unfulfilled account target from the latest conversation answer", () => {
    const action = { kind: "start-account-import", accountType: "WeChat", label: "WeChat", reasonEvidenceKey: "account" } as const;
    const conversation = {
      turns: [{ id: "turn-1", createdAt: "2026-10-03T10:00:00.000Z", report: {
        answer: { proposedUpdate: action },
        evidence: [{ key: "account", kind: "source-account-import-target", updateMethod: "screenshot" }],
      } }],
      importActivities: [],
    } as unknown as PortfolioAnalystConversation;
    expect(pendingScreenshotImportTarget(conversation)).toEqual(action);
    expect(pendingScreenshotImportTarget({ ...conversation, importActivities: [{
      draftId: "draft-1", targetLabel: "WeChat", submissionText: "", screenshotCount: 1,
      createdAt: "2026-10-03T10:01:00.000Z",
    }] })).toBeUndefined();
    expect(pendingScreenshotImportTarget({ ...conversation, turns: [...conversation.turns, {
      id: "turn-2", createdAt: "2026-10-03T10:02:00.000Z", imageAnswer: { text: "A fund screenshot" },
    } as PortfolioAnalystConversation["turns"][number]] })).toBeUndefined();
    expect(pendingScreenshotImportTarget({ ...conversation, turns: [...conversation.turns, {
      id: "turn-image", createdAt: "2026-10-03T10:02:00.000Z",
      importImage: { sourceTurnId: "turn-1" },
    } as PortfolioAnalystConversation["turns"][number]] })).toEqual(action);
    expect(pendingScreenshotImportTarget({ ...conversation, turns: [{
      ...conversation.turns[0]!, report: {
        ...conversation.turns[0]!.report!,
        evidence: [{ key: "account", kind: "source-account-import-target", updateMethod: "trading-212" }],
      },
    }] } as PortfolioAnalystConversation)).toBeUndefined();
  });

  it("reuses a saved image after a completed explanation and repeated import offer", () => {
    const report = {
      answer: { proposedUpdate: {
        kind: "start-account-import", accountType: "WeChat", label: "WeChat", reasonEvidenceKey: "account",
      } },
      evidence: [{ key: "account", kind: "source-account-import-target", updateMethod: "screenshot" }],
    };
    const conversation = {
      turns: [
        { id: "image", createdAt: "2026-10-03T10:00:00.000Z", attachments: [{ id: "saved-image" }],
          chat: { assistantText: "What should I do?", imageAction: { sourceTurnId: "image", stage: "intent" } } },
        { id: "answer", createdAt: "2026-10-03T10:01:00.000Z",
          imageAnswer: { status: "complete", sourceTurnId: "image", text: "Synthetic screenshot" } },
        { id: "offer", createdAt: "2026-10-03T10:02:00.000Z", report },
        { id: "repeat", createdAt: "2026-10-03T10:03:00.000Z", report },
      ],
      importActivities: [],
    } as unknown as PortfolioAnalystConversation;
    expect(resumableImageContext({ ...conversation, turns: conversation.turns.slice(0, 2) })).toEqual({
      sourceTurnId: "image", stage: "image-follow-up",
    });
    expect(resumableImageContext(conversation)).toEqual({
      sourceTurnId: "image", stage: "import-follow-up", preferredAccountType: "WeChat",
    });
    const unrelatedReport = { id: "other", question: "Other topic", createdAt: "2026-10-03T10:04:00.000Z", report: {
      answer: { proposedUpdate: undefined }, evidence: [],
    } } as unknown as PortfolioAnalystConversation["turns"][number];
    expect(resumableImageContext({ ...conversation, turns: [...conversation.turns, unrelatedReport] })).toEqual({
      sourceTurnId: "image", stage: "image-follow-up",
    });
    expect(resumableImageContext({ ...conversation, importActivities: [{
      draftId: "draft", targetLabel: "WeChat", submissionText: "", screenshotCount: 1,
      createdAt: "2026-10-03T10:04:00.000Z",
    }] })).toBeUndefined();
  });

});
