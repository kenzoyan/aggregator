import { readFile } from "node:fs/promises";

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { detectedSourceProvider } from "@/application/imports/vision-extractor";
import { OpenAIVisionExtractor } from "@/infrastructure/openai/openai-vision-extractor";

const runCloudEvaluation = process.env.RUN_OPENAI_VISION_EVAL === "1";

describe.skipIf(!runCloudEvaluation)("OpenAI vision import evaluation", () => {
  it("extracts a synthetic Chinese multi-holding screenshot", async () => {
    const { loadEnvConfig } = await import("@next/env");
    loadEnvConfig(process.cwd(), true);
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    expect(apiKey, "Set OPENAI_API_KEY in .env.local").not.toBe("");

    const extractor = new OpenAIVisionExtractor({
      apiKey,
      model: process.env.OPENAI_IMAGE_IMPORT_MODEL ?? "gpt-5.6-terra",
    });
    const image = await readFile(new URL(
      "../fixtures/vision-import/synthetic-alipay.png",
      import.meta.url,
    ));

    const result = await extractor.extract({
      images: [{ image, mimeType: "image/png" }],
      sourceAccountHint: "Alipay",
    });

    expect(detectedSourceProvider(result.accountName)).toBe("alipay");
    expect(result.asOf?.slice(0, 10)).toBe("2026-09-05");
    expect(result.currency).toBe("CNY");
    expect(new Decimal(result.totalValue ?? 0).equals("12345.67")).toBe(true);
    const byCode = new Map(result.positions.map((position) => [
      position.instrumentCode,
      position,
    ]));
    const technology = byCode.get("012345");
    const bond = byCode.get("006789");
    expect(technology).toBeDefined();
    expect(bond).toBeDefined();
    expect(new Decimal(technology?.quantity ?? 0).equals("5234.1234")).toBe(true);
    expect(new Decimal(technology?.marketValue ?? 0).equals("8234.56")).toBe(true);
    expect(new Decimal(technology?.costBasis ?? 0).equals("7500")).toBe(true);
    expect(new Decimal(technology?.reportedPriorReturn ?? 0).equals("734.56")).toBe(true);
    expect(new Decimal(technology?.observedPrice ?? 0).equals("1.5732")).toBe(true);
    expect(bond?.quantity).toBeNull();
    expect(new Decimal(bond?.marketValue ?? 0).equals("4111.11")).toBe(true);
    expect(new Decimal(bond?.costBasis ?? 0).equals("4000")).toBe(true);
    expect(new Decimal(bond?.reportedPriorReturn ?? 0).equals("111.11")).toBe(true);
    expect(bond?.observedPrice).toBeNull();
  }, 120_000);
});
