import { describe, expect, it } from "vitest";
import { normalizeAssistantMarkdown } from "@/components/assistant-markdown";
import { conversationTurnPlacement } from "@/components/analyst-conversation-view";

describe("heading recovery", () => {
  it("leaves normal prose, hashtags, indented code and fenced examples unchanged", () => {
    const text = "Use #portfolio and C#.\n\n## Normal heading\n\n```text\nMaster,## 今天的数据 是的——示例\n```\n\n    Master,## code example";
    expect(normalizeAssistantMarkdown(text)).toBe(text);
  });
  it("preserves greeting and body while separating an attached heading", () => {
    expect(normalizeAssistantMarkdown("Master,## 今天的数据 是的——这是合成数据。"))
      .toBe("Master,\n\n## 今天的数据\n\n是的——这是合成数据。");
  });
});

describe("new turn positioning", () => {
  it("provides enough scroll space for a short new exchange to sit one third from the top", () => {
    const placement = conversationTurnPlacement(1200, 1320, 600);
    expect(1200 - placement.scrollTop).toBe(200);
    expect(1320 + placement.spacerHeight - 600).toBe(placement.scrollTop);
  });
  it("does not add empty space to a long reply or request negative scrolling for the first message", () => {
    expect(conversationTurnPlacement(1200, 2100, 600).spacerHeight).toBe(0);
    expect(conversationTurnPlacement(0, 100, 600).scrollTop).toBe(0);
  });
});
