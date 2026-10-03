import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { demoScreenshotExtraction } from "@/application/imports/demo-extraction";
import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import {
  attachPortfolioAnalystImport,
  normalizePortfolioAnalystConversation,
  type PortfolioAnalystConversationStore,
  type PortfolioAnalystImageAttachment,
} from "@/application/portfolio-analyst-conversation";
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
import type { SourceAccountDefinition } from "@/domain/source-accounts";
import { OpenAIVisionExtractor } from "@/infrastructure/openai/openai-vision-extractor";
import {
  createLocalPortfolioAnalystImageStore,
  type PortfolioAnalystImageStore,
} from "@/infrastructure/local/portfolio-analyst-image-store";
import { getPortfolioDatabase } from "@/server/portfolio-db";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_COUNT = 6;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

async function isDecodableImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<boolean> {
  const expectedFormat = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  }[mimeType];
  try {
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();
    const validMetadata = metadata.format === expectedFormat &&
      Boolean(metadata.width && metadata.height) &&
      metadata.width! <= 20_000 && metadata.height! <= 20_000;
    if (!validMetadata) return false;
    await image.raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

interface AnalyzeImportDatabase {
  readSourceAccounts(): SourceAccountDefinition[];
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
  conversations?: PortfolioAnalystConversationStore;
  images?: PortfolioAnalystImageStore;
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
      const conversationId = form.get("conversationId");
      const sourceTurnId = form.get("sourceTurnId");
      const chatImport = conversationId !== null || sourceTurnId !== null;

      if (mode !== "image" && mode !== "demo") {
        return errorResponse("Choose an image import mode.", 400);
      }

      if (!sourceAccountId) {
        return errorResponse("Choose a source account.", 400);
      }
      const sourceAccount = input.database.readSourceAccounts()
        .find((account) => account.id === sourceAccountId);
      if (!sourceAccount) {
        return errorResponse("Choose a known source account.", 400);
      }

      let chatContext: {
        conversationId: string;
        sourceTurnId: string;
        draftId: string;
        targetLabel: string;
        submissionText: string;
        screenshotCount: number;
        attachments: PortfolioAnalystImageAttachment[];
      } | undefined;
      if (chatImport) {
        if (
          mode !== "image" ||
          typeof conversationId !== "string" || !conversationId || conversationId.length > 80 ||
          typeof sourceTurnId !== "string" || !sourceTurnId || sourceTurnId.length > 80 ||
          !input.conversations
        ) return errorResponse("Conversation image import is invalid.", 400);
        const storedConversation = input.conversations.readPortfolioAnalystConversation(conversationId);
        const conversation = storedConversation && normalizePortfolioAnalystConversation(storedConversation);
        if (!conversation || input.conversations.readLatestPortfolioAnalystConversation()?.id !== conversationId) {
          return errorResponse("Current conversation was not found.", 404);
        }
        const source = conversation.turns.find((turn) => turn.id === sourceTurnId);
        const action = conversation.turns.at(-1)?.chat?.imageAction;
        if (!source?.attachments?.length || action?.sourceTurnId !== sourceTurnId || action.accountId !== sourceAccountId) {
          return errorResponse("This image is not awaiting import for that account.", 409);
        }
        chatContext = {
          conversationId, sourceTurnId,
          draftId: `image-import-${createHash("sha256").update(`${conversationId}\0${sourceTurnId}`).digest("hex").slice(0, 32)}`,
          targetLabel: sourceAccount.label,
          submissionText: source.userText ?? "",
          screenshotCount: source.attachments.length,
          attachments: source.attachments,
        };
      }

      const attachChatDraft = (draft: StoredImportDraft) => {
        if (!chatContext) return undefined;
        if (draft.sourceAccountId !== sourceAccountId || draft.sourceKind !== "screenshot") {
          throw new Error("Chat import draft does not match its source account.");
        }
        const storedConversation = input.conversations!.readPortfolioAnalystConversation(chatContext.conversationId);
        const conversation = storedConversation && normalizePortfolioAnalystConversation(storedConversation);
        if (!conversation) throw new Error("Chat import conversation disappeared.");
        if (conversation.importActivities.some((activity) => activity.draftId === draft.id)) {
          return conversation;
        }
        const next = attachPortfolioAnalystImport(conversation, {
          draftId: draft.id,
          sourceTurnId: chatContext.sourceTurnId,
          targetLabel: chatContext.targetLabel,
          submissionText: chatContext.submissionText,
          screenshotCount: chatContext.screenshotCount,
          createdAt: input.now(),
        });
        input.conversations!.savePortfolioAnalystConversation(next);
        return next;
      };
      const existingChatDraft = chatContext && input.database.getImportDraft(chatContext.draftId);
      if (existingChatDraft) {
        const linked = attachChatDraft(existingChatDraft);
        return NextResponse.json({
          draft: createImportDraftReadModel(existingChatDraft),
          conversation: linked,
          visionProvider: "openai",
        });
      }

      let extractor: VisionExtractor;
      let images: Array<{
        image: Uint8Array;
        mimeType: "image/jpeg" | "image/png" | "image/webp";
      }> = [];

      if (mode === "demo") {
        extractor = fixtureVisionExtractor(demoScreenshotExtraction);
      } else {
        if (sourceAccount.updateMethod !== "screenshot") {
          return errorResponse(
            "Image import is available for screenshot-based accounts.",
            422,
          );
        }
        if (chatContext) {
          if (!input.images) return errorResponse("Saved images are unavailable.", 503);
          const attachments = chatContext.attachments ?? [];
          if (attachments.length === 0 || attachments.length > MAX_IMAGE_COUNT ||
            attachments.some((attachment) => attachment.byteLength > MAX_IMAGE_BYTES) ||
            attachments.reduce((total, attachment) => total + attachment.byteLength, 0) > MAX_TOTAL_IMAGE_BYTES) {
            return errorResponse("Saved images exceed the import limit.", 413);
          }
          const stored = await Promise.all(attachments.map(async (attachment) =>
            input.images!.read(attachment)
          ));
          if (stored.some((bytes, index) => !bytes || bytes.byteLength !== attachments[index]?.byteLength)) {
            return errorResponse("A saved screenshot could not be loaded.", 409);
          }
          images = attachments.map((attachment, index) => ({
            image: stored[index]!, mimeType: attachment.mimeType,
          }));
        } else {
          const selectedImages = form.getAll("images")
            .filter((value): value is File => value instanceof File);
          const legacyImage = form.get("image");
          const files = selectedImages.length > 0
            ? selectedImages
            : legacyImage instanceof File ? [legacyImage] : [];
          if (files.length === 0) return errorResponse("Choose at least one screenshot.", 400);
          if (files.length > MAX_IMAGE_COUNT) return errorResponse(`Choose no more than ${MAX_IMAGE_COUNT} screenshots.`, 413);
          if (files.some((file) => !supportedTypes.has(file.type))) return errorResponse("Only JPEG, PNG and WebP images are supported.", 415);
          if (files.some((file) => file.size > MAX_IMAGE_BYTES)) return errorResponse("Each image must be 10 MB or smaller.", 413);
          if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_IMAGE_BYTES) return errorResponse("The selected images must total 30 MB or less.", 413);
          images = await Promise.all(files.map(async (file) => ({
            image: new Uint8Array(await file.arrayBuffer()),
            mimeType: file.type as typeof images[number]["mimeType"],
          })));
        }
        if (images.some(({ image }) => image.length === 0)) {
          return errorResponse("Screenshots cannot be empty.", 400);
        }
        for (const image of images) {
          if (!await isDecodableImage(image.image, image.mimeType)) {
            return errorResponse(
              "A selected file does not match its JPEG, PNG or WebP format.",
              415,
            );
          }
        }
        extractor = input.createExtractor();
      }

      const extraction = await extractor.extract({
        images,
        sourceAccountHint: sourceAccount.label,
      });
      const detectedProvider = detectedSourceProvider(extraction.accountName);
      const providerMismatchWarning = detectedProvider &&
        detectedProvider !== sourceAccount.provider
        ? `Image analysis labeled this account as ${extraction.accountName}, which may not match the selected ${sourceAccount.label} account. Verify the source account before confirming.`
        : undefined;
      const reviewedExtraction = providerMismatchWarning
        ? {
            ...extraction,
            confidence: "low" as const,
            warnings: [
              ...extraction.warnings.slice(0, 19),
              providerMismatchWarning,
            ],
          }
        : extraction;
      const now = input.now();
      const draft = prepareScreenshotImport({
        draftId: chatContext?.draftId ?? input.newId(),
        snapshotId: input.newId(),
        sourceAccountId,
        createdAt: now,
        extraction: reviewedExtraction,
        sourceKind: mode === "demo" ? "demo" : "screenshot",
      });
      try {
        input.database.saveImportDraft(draft);
      } catch (error) {
        if (!chatContext || !input.database.getImportDraft(chatContext.draftId)) throw error;
      }
      const storedDraft = input.database.getImportDraft(draft.id)!;
      const linked = attachChatDraft(storedDraft);

      return NextResponse.json({
        draft: createImportDraftReadModel(storedDraft),
        ...(linked ? { conversation: linked } : {}),
        extraction: reviewedExtraction,
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
  const database = getPortfolioDatabase();
  return createAnalyzeImportHandler({
    database,
    conversations: database,
    images: createLocalPortfolioAnalystImageStore(),
    createExtractor: () =>
      new OpenAIVisionExtractor({
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: process.env.OPENAI_IMAGE_IMPORT_MODEL ?? "gpt-5.6-terra",
      }),
    newId: randomUUID,
    now: () => new Date().toISOString(),
  })(request);
}
