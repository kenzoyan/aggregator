import { describe, expect, it } from "vitest";

import {
  applyPortfolioAnalystStreamEvent,
  beginPendingPortfolioAnalystTurn,
  consumePortfolioAnalystStream,
} from "@/application/portfolio-analyst-stream";

describe("portfolio analyst streaming view state", () => {
  it("shows the submitted question before any model result exists", () => {
    const pending = beginPendingPortfolioAnalystTurn("本周为什么下跌？");

    expect(pending).toEqual({
      question: "本周为什么下跌？",
      answerText: "",
      activities: [],
      statusHistory: [],
      phase: "sending",
    });
  });

  it("accumulates safe tool activity separately from the answer text", () => {
    let pending = beginPendingPortfolioAnalystTurn("本周为什么下跌？");
    pending = applyPortfolioAnalystStreamEvent(pending, {
      type: "tool-activity",
      activity: {
        stage: "started",
        toolCallId: "tool-1",
        name: "read_period_drivers",
        input: { period: "week" },
      },
    });
    pending = applyPortfolioAnalystStreamEvent(pending, {
      type: "tool-activity",
      activity: {
        stage: "completed",
        toolCallId: "tool-1",
        name: "read_period_drivers",
        input: { period: "week" },
        factsAsOf: "2026-09-10T12:00:00.000Z",
        evidenceCount: 4,
      },
    });

    expect(pending.activities).toHaveLength(2);
    expect(pending.activities[1]).toMatchObject({
      stage: "completed",
      evidenceCount: 4,
    });
    expect(pending.answerText).toBe("");
  });

  it("accumulates genuine provider deltas into the pending assistant turn", () => {
    let pending = beginPendingPortfolioAnalystTurn("本周为什么下跌？");
    pending = applyPortfolioAnalystStreamEvent(pending, {
      type: "status",
      phase: "generating-answer",
    });
    pending = applyPortfolioAnalystStreamEvent(pending, {
      type: "answer-delta",
      delta: "主要",
    });
    pending = applyPortfolioAnalystStreamEvent(pending, {
      type: "answer-delta",
      delta: "来自价格变化。",
    });

    expect(pending.answerText).toBe("主要来自价格变化。");
    expect(pending.phase).toBe("generating-answer");
  });

  it("removes provisional text when final validation fails", () => {
    let pending = beginPendingPortfolioAnalystTurn("What changed?");
    pending = applyPortfolioAnalystStreamEvent(pending, {
      type: "answer-delta",
      delta: "Unvalidated partial text",
    });
    pending = applyPortfolioAnalystStreamEvent(pending, {
      type: "failed",
      error: "The final answer was invalid.",
    });

    expect(pending.answerText).toBe("");
    expect(pending.phase).toBe("failed");
  });

  it("parses NDJSON events even when transport chunks split a JSON line", async () => {
    const encoder = new TextEncoder();
    const events: unknown[] = [];
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"accepted","ques'));
        controller.enqueue(encoder.encode('tion":"why?"}\n{"type":"answer-delta","delta":"Hi"}\n'));
        controller.close();
      },
    }));

    await consumePortfolioAnalystStream(response, (event) => events.push(event));

    expect(events).toEqual([
      { type: "accepted", question: "why?" },
      { type: "answer-delta", delta: "Hi" },
    ]);
  });
});
