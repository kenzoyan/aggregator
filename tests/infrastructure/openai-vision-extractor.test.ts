import { describe, expect, it, vi } from "vitest";

import {
  OpenAIVisionExtractor,
} from "@/infrastructure/openai/openai-vision-extractor";
import { VisionExtractionError } from "@/application/imports/vision-extractor";

const extraction = {
  accountName: "Alipay",
  asOf: "2026-09-05T00:00:00.000Z",
  currency: "CNY",
  totalValue: "110",
  reportedPriorReturn: "10",
  portfolioCash: null,
  confidence: "high" as const,
  warnings: [],
  positions: [{
    displayName: "Synthetic Fund",
    instrumentCode: "012345",
    assetType: "fund" as const,
    quantity: "10",
    currency: "CNY",
    marketValue: "110",
    costBasis: "100",
    reportedPriorReturn: "10",
    reportedPriorReturnPercent: "10",
    averageCost: "10",
    observedPrice: "11",
    priceAsOf: "2026-09-05T00:00:00.000Z",
    confidence: "high" as const,
  }],
};

function completedResponse(content: unknown) {
  return new Response(JSON.stringify({
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(content) }],
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("OpenAI vision import extractor", () => {
  it("sends an image directly and validates structured extraction", async () => {
    const fetch = vi.fn(async () => completedResponse(extraction));
    const extractor = new OpenAIVisionExtractor({
      apiKey: "synthetic-key",
      model: "synthetic-vision-model",
      fetch,
    });

    await expect(extractor.extract({
      images: [
        { image: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
        { image: new Uint8Array([4, 5]), mimeType: "image/jpeg" },
      ],
      sourceAccountHint: "Alipay",
    })).resolves.toEqual(extraction);

    expect(fetch).toHaveBeenCalledOnce();
    const [, request] = fetch.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const body = JSON.parse(String(request?.body));
    expect(body.input[0].content[0].text).toContain(
      "The user-selected Source Account is authoritative",
    );
    expect(body).toMatchObject({
      model: "synthetic-vision-model",
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_text" },
          {
            type: "input_image",
            image_url: "data:image/png;base64,AQID",
            detail: "original",
          },
          {
            type: "input_image",
            image_url: "data:image/jpeg;base64,BAU=",
            detail: "original",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "portfolio_screenshot_extraction",
          strict: true,
        },
      },
    });
  });

  it("rejects output with neither holdings nor an explicit cash balance", async () => {
    const extractor = new OpenAIVisionExtractor({
      apiKey: "synthetic-key",
      model: "synthetic-vision-model",
      fetch: async () => completedResponse({ ...extraction, positions: [] }),
    });

    await expect(extractor.extract({
      images: [{ image: new Uint8Array([1]), mimeType: "image/jpeg" }],
    })).rejects.toMatchObject({
      code: "invalid-response",
      message: "OpenAI could not identify any holdings in this screenshot.",
    });
  });

  it("accepts a cash-only account screenshot", async () => {
    const cashOnly = {
      ...extraction,
      totalValue: "75.25",
      portfolioCash: { amount: "75.25", currency: "EUR" },
      positions: [],
    };
    const extractor = new OpenAIVisionExtractor({
      apiKey: "synthetic-key",
      model: "synthetic-vision-model",
      fetch: async () => completedResponse(cashOnly),
    });

    await expect(extractor.extract({
      images: [{ image: new Uint8Array([1]), mimeType: "image/png" }],
    })).resolves.toEqual(cashOnly);
  });

  it("rejects non-decimal financial values before creating a draft", async () => {
    const extractor = new OpenAIVisionExtractor({
      apiKey: "synthetic-key",
      model: "synthetic-vision-model",
      fetch: async () => completedResponse({
        ...extraction,
        positions: [{ ...extraction.positions[0], marketValue: "CNY 110" }],
      }),
    });

    await expect(extractor.extract({
      images: [{ image: new Uint8Array([1]), mimeType: "image/png" }],
    })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("maps rate limits without exposing provider response details", async () => {
    const extractor = new OpenAIVisionExtractor({
      apiKey: "synthetic-key",
      model: "synthetic-vision-model",
      fetch: async () => new Response("secret provider detail", { status: 429 }),
    });

    await expect(extractor.extract({
      images: [{ image: new Uint8Array([1]), mimeType: "image/webp" }],
    })).rejects.toEqual(new VisionExtractionError("rate-limited"));
  });

  it("fails safely when no API key is configured", () => {
    expect(() => new OpenAIVisionExtractor({
      apiKey: "",
      model: "synthetic-vision-model",
    })).toThrow(new VisionExtractionError("not-configured"));
  });
});
