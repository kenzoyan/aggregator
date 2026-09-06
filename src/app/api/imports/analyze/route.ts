import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { demoScreenshotExtraction } from "@/application/imports/demo-extraction";
import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import {
  detectedSourceProvider,
  fixtureVisionExtractor,
  prepareScreenshotImport,
  VisionExtractionError,
  type VisionExtractor,
} from "@/application/imports/vision-extractor";
import type {
  ImportDraftInput,
  StoredImportDraft,
} from "@/domain/imports";
import { findSourceAccount } from "@/domain/source-accounts";
import { OpenAIVisionExtractor } from "@/infrastructure/openai/openai-vision-extractor";
import { getPortfolioDatabase } from "@/server/portfolio-db";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

interface AnalyzeImportDatabase {
  saveImportDraft(draft: ImportDraftInput): void;
  getImportDraft(id: string): StoredImportDraft | undefined;
}

function visionErrorStatus(error: VisionExtractionError): number {
  if (
    error.code === "not-configured" ||
    error.code === "authentication-failed"
  ) return 503;
  if (
    error.code === "rate-limited"
  ) return 429;
  if (error.code === "invalid-response") return 422;
  if (error.code === "timeout") return 504;
  return 502;
}

export function createAnalyzeImportHandler(input: {
  database: AnalyzeImportDatabase;
  createExtractor: () => VisionExtractor;
  newId: () => string;
  now: () => string;
  logError?: (message: string, error: unknown) => void;
}) {
  return async function handleAnalyzeImport(request: Request) {
    try {
      const form = await request.formData();
      const mode = form.get("mode");
      const sourceAccountId = String(form.get("sourceAccountId") ?? "").trim();

      if (mode !== "image" && mode !== "demo") {
        return errorResponse("Choose an image import mode.", 400);
      }

      if (!sourceAccountId) {
        return errorResponse("Choose a source account.", 400);
      }
      const sourceAccount = findSourceAccount(sourceAccountId);
      if (!sourceAccount) {
        return errorResponse("Choose a known source account.", 400);
      }

      let extractor: VisionExtractor;
      let image = new Uint8Array();
      let mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg";

      if (mode === "demo") {
        extractor = fixtureVisionExtractor(demoScreenshotExtraction);
      } else {
        if (sourceAccount.updateMethod !== "screenshot") {
          return errorResponse(
            "Image import is available for screenshot-based accounts.",
            422,
          );
        }
        const file = form.get("image");
        if (!(file instanceof File)) {
          return errorResponse("Choose a screenshot.", 400);
        }
        if (!supportedTypes.has(file.type)) {
          return errorResponse("Only JPEG, PNG and WebP images are supported.", 415);
        }
        if (file.size > MAX_IMAGE_BYTES) {
          return errorResponse("The image must be 10 MB or smaller.", 413);
        }

        extractor = input.createExtractor();
        image = new Uint8Array(await file.arrayBuffer());
        mimeType = file.type as typeof mimeType;
      }

      const extraction = await extractor.extract({
        image,
        mimeType,
        sourceAccountHint: sourceAccount.label,
      });
      const detectedProvider = detectedSourceProvider(extraction.accountName);
      if (detectedProvider && detectedProvider !== sourceAccount.provider) {
        return errorResponse(
          `This screenshot appears to belong to a different provider than ${sourceAccount.label}. Choose the matching Source Account and try again.`,
          422,
        );
      }
      const now = input.now();
      const draft = prepareScreenshotImport({
        draftId: input.newId(),
        snapshotId: input.newId(),
        sourceAccountId,
        createdAt: now,
        extraction,
        sourceKind: mode === "demo" ? "demo" : "screenshot",
      });
      input.database.saveImportDraft(draft);

      return NextResponse.json({
        draft: createImportDraftReadModel(input.database.getImportDraft(draft.id)!),
        extraction,
        visionProvider: mode === "demo" ? "demo" : "openai",
      });
    } catch (error) {
      if (error instanceof VisionExtractionError) {
        return errorResponse(error.message, visionErrorStatus(error));
      }
      (input.logError ?? console.error)(
        "Screenshot import failed",
        { name: error instanceof Error ? error.name : "UnknownError" },
      );
      return errorResponse(
        "Image analysis failed. Try again later or use manual entry.",
        500,
      );
    }
  };
}

export async function POST(request: Request) {
  return createAnalyzeImportHandler({
    database: getPortfolioDatabase(),
    createExtractor: () =>
      new OpenAIVisionExtractor({
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: process.env.OPENAI_IMAGE_IMPORT_MODEL ?? "gpt-5.6-terra",
      }),
    newId: randomUUID,
    now: () => new Date().toISOString(),
  })(request);
}
