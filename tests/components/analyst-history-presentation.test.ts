import { describe, expect, it } from "vitest";
import { analystHistoryDay, analystHistoryEntries } from "@/components/analyst-history-presentation";
import { createPortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";

describe("continuous analyst history", () => {
  it("orders messages and import follow-ups by time while keeping distinct identities", () => {
    const conversation = createPortfolioAnalystConversation({ id: "synthetic-conversation", now: "2026-10-09T08:00:00Z", provider: "openai", language: "en", includeHoldingNames: true });
    conversation.turns = [{ id: "turn-1", createdAt: "2026-10-09T08:00:00Z", question: "Synthetic question", chat: { assistantText: "Synthetic answer" } }];
    conversation.importActivities = [{
      draftId: "draft-1", submissionText: "Synthetic import", targetLabel: "Synthetic account", createdAt: "2026-10-08T08:00:00Z",
      screenshotCount: 1, followUps: [{ id: "follow-1", createdAt: "2026-10-09T09:00:00Z", userText: "Synthetic follow-up", assistantText: "Synthetic reply" }],
    }];
    const entries = analystHistoryEntries(conversation);
    expect(entries.map((entry) => entry.kind)).toEqual(["import", "turn", "import-follow-up"]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
    expect(conversation.turns[0]?.id).toBe("turn-1");
  });

  it("groups by Helsinki calendar day instead of the UTC timestamp day", () => {
    expect(analystHistoryDay("2026-10-08T22:30:00Z")).toBe(analystHistoryDay("2026-10-09T08:30:00Z"));
    expect(analystHistoryDay("2026-10-08T08:30:00Z")).not.toBe(analystHistoryDay("2026-10-09T08:30:00Z"));
  });
});
