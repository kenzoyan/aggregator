import { describe, expect, it, vi } from "vitest";

import { createAnalyzeImportHandler } from "@/app/api/imports/analyze/route";
import type {
  ImportDraftInput,
  StoredImportDraft,
} from "@/domain/imports";
import { MinerUOcrError } from "@/infrastructure/mineru/mineru-ocr-provider";
import type { ScreenshotExtraction } from "@/application/imports/vision-extractor";

const extraction: ScreenshotExtraction = {
  accountName: "Alipay",
  asOf: "2026-07-22T00:00:00.000Z",
  currency: "CNY",
  totalValue: "110",
  reportedPriorReturn: "10",
  confidence: "high",
  warnings: ["Synthetic OCR fixture."],
  positions: [{
    displayName: "Synthetic OCR Fund",
    instrumentCode: "012345",
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

function imageRequest(sourceAccountId = "alipay-main") {
  const form = new FormData();
  form.set("sourceAccountId", sourceAccountId);
  form.set("sourceAccountHint", "Alipay");
  form.set("mode", "image");
  form.set("image", new File(
    [new Uint8Array([1, 2, 3])],
    "synthetic.png",
    { type: "image/png" },
  ));
  return new Request("http://localhost/api/imports/analyze", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/imports/analyze", () => {
  it("creates an editable Import Draft from MinerU-backed extraction", async () => {
    const store = database();
    const extract = vi.fn(async () => extraction);
    const handler = createAnalyzeImportHandler({
      database: store,
      createExtractor: () => ({ extract }),
      newId: (() => {
        const ids = ["draft-ocr", "snapshot-ocr"];
        return () => ids.shift() ?? "unexpected";
      })(),
      now: () => "2026-07-23T12:00:00.000Z",
    });

    const response = await handler(imageRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ocrProvider: "mineru-precision-vlm",
      draft: {
        id: "draft-ocr",
        sourceKind: "screenshot",
        status: "draft",
        portfolio: {
          holdings: [{
            instrumentId: "012345",
            instrumentCode: "012345",
            quantity: "10",
            costBasis: "100",
            observedPrice: "11",
            priceAsOf: "2026-07-22T00:00:00.000Z",
          }],
        },
      },
    });
    expect(extract).toHaveBeenCalledWith({
      image: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      sourceAccountHint: "Alipay",
    });
    expect(store.saveImportDraft).toHaveBeenCalledOnce();
  });

  it("does not send unsupported source accounts through Alipay parsing", async () => {
    const createExtractor = vi.fn();
    const handler = createAnalyzeImportHandler({
      database: database(),
      createExtractor,
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
    });

    const response = await handler(imageRequest("wechat-main"));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "MinerU screenshot parsing currently supports Alipay accounts.",
    });
    expect(createExtractor).not.toHaveBeenCalled();
  });

  it("returns MinerU rate limits without exposing provider internals", async () => {
    const handler = createAnalyzeImportHandler({
      database: database(),
      createExtractor: () => ({
        extract: async () => {
          throw new MinerUOcrError("rate-limited");
        },
      }),
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
      logError: () => undefined,
    });

    const response = await handler(imageRequest());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "MinerU is busy. Wait a minute and try again.",
    });
  });

  it("returns a safe configuration error without creating a draft", async () => {
    const store = database();
    const handler = createAnalyzeImportHandler({
      database: store,
      createExtractor: () => {
        throw new MinerUOcrError("not-configured");
      },
      newId: () => "id",
      now: () => "2026-07-23T12:00:00.000Z",
      logError: () => undefined,
    });

    const response = await handler(imageRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "MinerU Precision is not configured on this device.",
    });
    expect(store.saveImportDraft).not.toHaveBeenCalled();
  });
});
