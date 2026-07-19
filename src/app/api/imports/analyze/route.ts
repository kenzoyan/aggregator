import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { demoScreenshotExtraction } from "@/application/imports/demo-extraction";
import {
  fixtureVisionExtractor,
  prepareScreenshotImport,
  type VisionExtractor,
} from "@/application/imports/vision-extractor";
import { OpenAIVisionExtractor } from "@/infrastructure/openai/openai-vision-extractor";
import { getPortfolioRepository } from "@/server/portfolio-db";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function configuredExtractor(): VisionExtractor | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_VISION_MODEL;
  return apiKey && model ? new OpenAIVisionExtractor(apiKey, model) : undefined;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const mode = form.get("mode");
    const sourceAccountId = String(form.get("sourceAccountId") ?? "").trim();
    const sourceAccountHint = String(form.get("sourceAccountHint") ?? "").trim();

    if (!sourceAccountId) {
      return errorResponse("Choose a source account.", 400);
    }

    let extractor: VisionExtractor;
    let image = new Uint8Array();
    let mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg";

    if (mode === "demo") {
      extractor = fixtureVisionExtractor(demoScreenshotExtraction);
    } else {
      const file = form.get("image");
      if (!(file instanceof File)) {
        return errorResponse("Choose a screenshot.", 400);
      }
      if (!supportedTypes.has(file.type)) {
        return errorResponse("Only JPEG, PNG and WebP images are supported.", 415);
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return errorResponse("The image must be 12 MB or smaller.", 413);
      }

      const cloudExtractor = configuredExtractor();
      if (!cloudExtractor) {
        return errorResponse(
          "Cloud image analysis is not configured on this device. You can use the demo workflow first.",
          503,
        );
      }

      extractor = cloudExtractor;
      image = new Uint8Array(await file.arrayBuffer());
      mimeType = file.type as typeof mimeType;
    }

    const extraction = await extractor.extract({
      image,
      mimeType,
      ...(sourceAccountHint ? { sourceAccountHint } : {}),
    });
    const now = new Date().toISOString();
    const draft = prepareScreenshotImport({
      draftId: randomUUID(),
      snapshotId: randomUUID(),
      sourceAccountId,
      createdAt: now,
      extraction,
    });
    const repository = getPortfolioRepository();
    repository.createImportDraft(draft);

    return NextResponse.json({
      draft: repository.getImportDraft(draft.id),
      extraction,
    });
  } catch (error) {
    console.error("Screenshot import failed", error);
    return errorResponse("Image analysis failed. Try again later or use manual entry.", 500);
  }
}
