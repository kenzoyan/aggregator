import { describe, expect, it } from "vitest";

import { pendingScreenshotImportTarget, requestsScreenshotImport } from "@/application/agent-image-intent";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";

describe("image message intent", () => {
  it("keeps ordinary image questions in the image-answer conversation path", () => {
    expect(requestsScreenshotImport("explain this pic to me", false)).toBe(false);
    expect(requestsScreenshotImport("What does this screenshot show?", false)).toBe(false);
    expect(requestsScreenshotImport("", false)).toBe(false);
  });

  it("keeps explicit account updates in the confirmation-based import flow", () => {
    expect(requestsScreenshotImport("update my WeChat assets", false)).toBe(true);
    expect(requestsScreenshotImport("帮我导入这些持仓", false)).toBe(true);
    expect(requestsScreenshotImport("", true)).toBe(true);
    expect(requestsScreenshotImport("explain this screenshot", true)).toBe(false);
    expect(requestsScreenshotImport("解释一下这张截图", true)).toBe(false);
    expect(requestsScreenshotImport("import these holdings and explain them", true)).toBe(true);
  });

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

});
