import { describe, expect, it } from "vitest";

import {
  consumePortfolioAnalystImageStream,
  type PortfolioAnalystImageStreamEvent,
} from "@/application/portfolio-analyst-image-stream";

describe("image response stream", () => {
  it("reads answer deltas across network chunks before completion", async () => {
    const chunks = [
      '{"type":"delta","delta":"The"}\n{"type":"del',
      'ta","delta":" image"}\n{"type":"completed","conversation":{"id":"conversation-1"}}\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }));
    const events: PortfolioAnalystImageStreamEvent[] = [];
    await consumePortfolioAnalystImageStream(response, (event) => events.push(event));
    expect(events.map((event) => event.type)).toEqual(["delta", "delta", "completed"]);
    expect(events.filter((event) => event.type === "delta").map((event) => event.delta).join(""))
      .toBe("The image");
  });
});
