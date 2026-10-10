import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import { portfolioAnalystOutputTokenLimit } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";

describe("portfolio summary output budget", () => {
  it("gives complete holdings summaries more output space while preserving normal and error budgets", () => {
    const result: Message = { role: "toolResult", toolName: "read_all_holdings", toolCallId: "all", content: [], isError: false, timestamp: 0 };
    expect(portfolioAnalystOutputTokenLimit([result])).toBe(8000);
    expect(portfolioAnalystOutputTokenLimit([{ ...result, isError: true }])).toBe(1100);
    expect(portfolioAnalystOutputTokenLimit([{ ...result, toolName: "read_account_holdings" }])).toBe(1100);
    expect(portfolioAnalystOutputTokenLimit([])).toBe(1100);
  });
});

it("keeps enough output space for image interpretation and structured import draft arguments", () => {
  expect(portfolioAnalystOutputTokenLimit([{ role: "user", content: [
    { type: "text", text: "Explain this" }, { type: "image", data: "AQ==", mimeType: "image/png" },
  ], timestamp: 0 }])).toBe(8000);
});
