import { describe, expect, it, vi } from "vitest";

import { createAnalyzeImportHandler } from "@/app/api/imports/analyze/route";
import type {
  ImportDraftInput,
  StoredImportDraft,
} from "@/domain/imports";
import {
  VisionExtractionError,
  type ScreenshotExtraction,
} from "@/application/imports/vision-extractor";

const extraction: ScreenshotExtraction = {
  accountName: "Alipay",
  asOf: "2026-07-22T00:00:00.000Z",
  currency: "CNY",
  totalValue: "110",
  reportedPriorReturn: "10",
  portfolioCash: null,
  confidence: "high",
  warnings: ["Synthetic vision fixture."],
  positions: [{
    displayName: "Synthetic Vision Fund",
    instrumentCode: "012345",
    assetType: "fund",
    quantity: "10",
    currency: "CNY",
    marketValue: "110",
    costBasis: "100",
    reportedPriorReturn: "10",
    reportedPriorReturnPercent: "10",
    averageCost: "10",
    observedPrice: "11",
    priceAsOf: "2026-07-22T00:00:00.000Z",
    confidence: "high",
  }],
};

function database() {
  const drafts = new Map<string, StoredImportDraft>();
  return {
    saveImportDraft: vi.fn((draft: ImportDraftInput) => {
      drafts.set(draft.id, { ...draft, status: "draft" });
    }),
    getImportDraft: vi.fn((id: string) => drafts.get(id)),
  };
}

const pngBytes = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

function imageRequest(sourceAccountId = "alipay-main") {
  const form = new FormData();
  form.set("sourceAccountId", sourceAccountId);
  form.set("mode", "image");
  form.set("image", new File(
    [pngBytes],
    "synthetic.png",
    { type: "image/png" },
  ));
  return new Request("http://localhost/api/imports/analyze", {
    method: "POST",
    body: form,
  });
}

function multiImageRequest(sourceAccountId = "danske-main") {
  const form = new FormData();
  form.set("sourceAccountId", sourceAccountId);
  form.set("mode", "image");
  form.append("images", new File(
    [pngBytes],
    "synthetic-overview.png",
    { type: "image/png" },
  ));
  form.append("images", new File(
    [pngBytes],
    "synthetic-details.png",
    { type: "image/png" },
  ));
  return new Request("http://localhost/api/imports/analyze", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/imports/analyze", () => {
  it("creates an editable Import Draft from direct vision extraction", async () => {
    const store = database();
    const extract = vi.fn(async () => extraction);
    const handler = createAnalyzeImportHandler({
      database: store,
      createExtractor: () => ({ extract }),
      newId: (() => {
        const ids = ["draft-vision", "snapshot-vision"];
        return () => ids.shift() ?? "unexpected";
      })(),
      now: () => "2026-07-23T12:00:00.000Z",
    });

    const response = await handler(imageRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      visionProvider: "openai",
      draft: {
        id: "draft-vision",
        sourceKind: "screenshot",
        status: "draft",
        portfolio: {
          holdings: [{
            instrumentId: "012345",
            instrumentCode: "012345",
            assetType: "fund",
            quantity: "10",
            costBasis: "100",
            observedPrice: "11",
            priceAsOf: "2026-07-22T00:00:00.000Z",
          }],
        },
      },
    });
    expect(extract).toHaveBeenCalledWith({
      images: [{ image: pngBytes, mimeType: "image/png" }],
      sourceAccountHint: "Alipay",
    });
    expect(store.saveImportDraft).toHaveBeenCalledOnce();
  });

  it("supports every account configured for screenshot imports", async () => {
    const extract = vi.fn(async () => ({
      ...extraction,
      accountName: "WeChat",
    }));
    const handler = createAnalyzeImportHandler({
      database: database(),
      createExtractor: () => ({ extract }),
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
    });

    const response = await handler(imageRequest("wechat-main"));

    expect(response.status).toBe(200);
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      sourceAccountHint: "WeChat Wealth Management",
    }));
  });

  it("sends complementary screenshots as one extraction request", async () => {
    const extract = vi.fn(async () => ({
      ...extraction,
      accountName: "Danske Trade Online",
    }));
    const handler = createAnalyzeImportHandler({
      database: database(),
      createExtractor: () => ({ extract }),
      newId: () => "id",
      now: () => "2026-09-06T12:00:00.000Z",
    });

    const response = await handler(multiImageRequest());

    expect(response.status).toBe(200);
    expect(extract).toHaveBeenCalledWith({
      images: [
        { image: pngBytes, mimeType: "image/png" },
        { image: pngBytes, mimeType: "image/png" },
      ],
      sourceAccountHint: "Danske Bank",
    });
  });

  it("rejects too many screenshots before creating an extractor", async () => {
    const form = new FormData();
    form.set("sourceAccountId", "danske-main");
    form.set("mode", "image");
    for (let index = 0; index < 7; index += 1) {
      form.append("images", new File(
        [new Uint8Array([index])],
        `synthetic-${index}.png`,
        { type: "image/png" },
      ));
    }
    const createExtractor = vi.fn();
    const handler = createAnalyzeImportHandler({
      database: database(),
      createExtractor,
      newId: () => "id",
      now: () => "2026-09-06T12:00:00.000Z",
    });

    const response = await handler(new Request(
      "http://localhost/api/imports/analyze",
      { method: "POST", body: form },
    ));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Choose no more than 6 screenshots.",
    });
    expect(createExtractor).not.toHaveBeenCalled();
  });

  it("rejects empty and spoofed images before creating an extractor", async () => {
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array([1, 2, 3]),
      pngBytes.slice(0, 50),
    ]) {
      const form = new FormData();
      form.set("sourceAccountId", "danske-main");
      form.set("mode", "image");
      form.set("image", new File([bytes], "spoofed.png", { type: "image/png" }));
      const createExtractor = vi.fn();
      const handler = createAnalyzeImportHandler({
        database: database(),
        createExtractor,
        newId: () => "id",
        now: () => "2026-09-06T12:00:00.000Z",
      });

      const response = await handler(new Request(
        "http://localhost/api/imports/analyze",
        { method: "POST", body: form },
      ));

      expect(response.status).toBe(bytes.length === 0 ? 400 : 415);
      expect(createExtractor).not.toHaveBeenCalled();
    }
  });

  it("blocks an obvious provider mismatch before saving a draft", async () => {
    const store = database();
    const handler = createAnalyzeImportHandler({
      database: store,
      createExtractor: () => ({ extract: async () => extraction }),
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
    });

    const response = await handler(imageRequest("wechat-main"));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "This screenshot appears to belong to a different provider than WeChat Wealth Management. Choose the matching Source Account and try again.",
    });
    expect(store.saveImportDraft).not.toHaveBeenCalled();
  });

  it("does not send connector accounts through image extraction", async () => {
    const createExtractor = vi.fn();
    const handler = createAnalyzeImportHandler({
      database: database(),
      createExtractor,
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
    });

    const response = await handler(imageRequest("trading212-main"));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Image import is available for screenshot-based accounts.",
    });
    expect(createExtractor).not.toHaveBeenCalled();
  });

  it("returns OpenAI rate limits without exposing provider internals", async () => {
    const handler = createAnalyzeImportHandler({
      database: database(),
      createExtractor: () => ({
        extract: async () => {
          throw new VisionExtractionError("rate-limited");
        },
      }),
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
      logError: () => undefined,
    });

    const response = await handler(imageRequest());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI is busy. Wait a minute and try again.",
    });
  });

  it("returns a safe configuration error without creating a draft", async () => {
    const store = database();
    const handler = createAnalyzeImportHandler({
      database: store,
      createExtractor: () => {
        throw new VisionExtractionError("not-configured");
      },
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
      logError: () => undefined,
    });

    const response = await handler(imageRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI image import is not configured on this device.",
    });
    expect(store.saveImportDraft).not.toHaveBeenCalled();
  });
});
