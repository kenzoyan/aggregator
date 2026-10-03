import { describe, expect, it, vi } from "vitest";

import { createOpenAIImageQuestion, projectPartialImageAnswer } from "@/infrastructure/openai/openai-image-question";

describe("OpenAI image question", () => {
  it("projects the answer text from an incomplete structured response", () => {
    expect(projectPartialImageAnswer('{"answer":"The image shows \\u20ac12'))
      .toBe("The image shows €12");
  });

  it("sends the user's question with image bytes and returns a bounded answer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        answer: "A synthetic portfolio image.", uncertainties: ["The date is not visible."],
      }) }] }],
    }), { status: 200 }));
    const ask = createOpenAIImageQuestion({
      apiKey: "synthetic-key", model: "synthetic-vision-model", fetch,
    });
    await expect(ask({
      question: "explain this pic to me", language: "en",
      images: [{ mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
    })).resolves.toEqual({
      answer: "A synthetic portfolio image.", uncertainties: ["The date is not visible."],
    });
    const [, request] = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.store).toBe(false);
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "explain this pic to me" },
      { type: "input_image", image_url: "data:image/png;base64,AQID", detail: "original" },
    ]);
  });

  it("delivers partial answer text while the provider streams structured JSON", async () => {
    const pieces = ['{"answer":"The ', 'image is clear.","uncertainties":[]}'];
    const events = pieces.map((delta) => `data: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`).join("");
    const fetch = vi.fn(async () => new Response(events, { status: 200 }));
    const ask = createOpenAIImageQuestion({
      apiKey: "synthetic-key", model: "synthetic-vision-model", fetch,
    });
    const deltas: string[] = [];
    const result = await ask({
      question: "Explain", language: "en",
      images: [{ mimeType: "image/png", bytes: new Uint8Array([1]) }],
      onAnswerTextDelta: (delta) => deltas.push(delta),
    });
    expect(deltas.join("")).toBe("The image is clear.");
    expect(result.answer).toBe("The image is clear.");
  });
});
