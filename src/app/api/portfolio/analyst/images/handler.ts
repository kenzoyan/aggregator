import { randomUUID } from "node:crypto";

import sharp from "sharp";

import {
  appendPortfolioAnalystTurn,
  appendPortfolioAnalystImportImageTurn,
  createPortfolioAnalystConversation,
  normalizePortfolioAnalystConversation,
  type PortfolioAnalystConversationStore,
  type PortfolioAnalystImageAttachment,
} from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import type { ImageQuestionAnswer, ImageQuestionInput } from "@/infrastructure/openai/openai-image-question";

const MAX_IMAGE_COUNT = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
const imageFormats = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
type ImageMimeType = keyof typeof imageFormats;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

async function isValidImage(bytes: Uint8Array, mimeType: ImageMimeType): Promise<boolean> {
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (
      metadata.format !== imageFormats[mimeType] ||
      !metadata.width || !metadata.height ||
      metadata.width > 20_000 || metadata.height > 20_000
    ) return false;
    await image.raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

async function checkedImages(files: FormDataEntryValue[]): Promise<
  Array<{ mimeType: ImageMimeType; bytes: Uint8Array }> | Response
> {
  if (files.length < 1 || files.length > MAX_IMAGE_COUNT || files.some((file) => !(file instanceof File))) {
    return errorResponse("Choose 1–6 images for a conversation message.", 400);
  }
  const images = files as File[];
  if (images.some((file) => !Object.hasOwn(imageFormats, file.type))) {
    return errorResponse("Only JPEG, PNG and WebP images are supported.", 415);
  }
  if (
    images.some((file) => file.size === 0 || file.size > MAX_IMAGE_BYTES) ||
    images.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_IMAGE_BYTES
  ) return errorResponse("Images must be nonempty, at most 10 MB each and 30 MB together.", 413);
  const checked = [] as Array<{ mimeType: ImageMimeType; bytes: Uint8Array }>;
  for (const file of images) {
    const mimeType = file.type as ImageMimeType;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!await isValidImage(bytes, mimeType)) {
      return errorResponse("A selected image does not match its format.", 415);
    }
    checked.push({ mimeType, bytes });
  }
  return checked;
}

export function createPortfolioAnalystImageHandlers(input: {
  conversations: PortfolioAnalystConversationStore;
  images: PortfolioAnalystImageStore;
  createId?: () => string;
  imageQuestion?: (input: ImageQuestionInput) => Promise<ImageQuestionAnswer>;
  imageModel?: string;
}) {
  return {
    async POST(request: Request) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return errorResponse("Image upload is invalid.", 400);
      }
      const conversationId = form.get("conversationId");
      const turnId = form.get("turnId");
      const userText = form.get("userText");
      const files = form.getAll("images");
      if (
        typeof conversationId !== "string" || !conversationId ||
        typeof turnId !== "string" || !turnId ||
        typeof userText !== "string" || userText.length > 600 ||
        files.length < 1 || files.length > MAX_IMAGE_COUNT
      ) return errorResponse("Choose 1–6 images for a conversation message.", 400);
      const conversation = input.conversations.readPortfolioAnalystConversation(conversationId);
      const turn = conversation?.turns.find((item) => item.id === turnId);
      if (!conversation || !turn) return errorResponse("Conversation message was not found.", 404);
      if (input.conversations.readLatestPortfolioAnalystConversation()?.id !== conversationId) {
        return errorResponse("Only the current conversation can receive images.", 409);
      }
      if (conversation.turns.some((item) => item.importImage?.sourceTurnId === turnId)) {
        return errorResponse("This import already has a screenshot message.", 409);
      }
      if (!turn.report) return errorResponse("The import source message was not found.", 409);

      const checked = await checkedImages(files);
      if (checked instanceof Response) return checked;

      const saved: PortfolioAnalystImageAttachment[] = [];
      try {
        for (const image of checked) {
          const attachment: PortfolioAnalystImageAttachment = {
            id: (input.createId ?? randomUUID)(),
            mimeType: image.mimeType,
            byteLength: image.bytes.byteLength,
          };
          await input.images.save(attachment, image.bytes);
          saved.push(attachment);
        }
        const next = appendPortfolioAnalystImportImageTurn(conversation, {
          sourceTurnId: turnId, id: randomUUID(), createdAt: new Date().toISOString(),
          userText, attachments: saved,
        });
        input.conversations.savePortfolioAnalystConversation(next);
        return Response.json({ conversation: next }, { headers: { "cache-control": "no-store" } });
      } catch {
        await Promise.allSettled(saved.map((attachment) => input.images.delete(attachment)));
        return errorResponse("Images could not be saved locally.", 500);
      }
    },

    async ASK(request: Request) {
      if (!input.imageQuestion || !input.imageModel) {
        return errorResponse("Image questions are not configured.", 503);
      }
      let form: FormData;
      try { form = await request.formData(); }
      catch { return errorResponse("Image upload is invalid.", 400); }
      const conversationId = form.get("conversationId");
      const userText = form.get("userText");
      const language = form.get("language");
      const includeHoldingNames = form.get("includeHoldingNames");
      if (
        (conversationId !== null && (typeof conversationId !== "string" || conversationId.length > 80)) ||
        typeof userText !== "string" || userText.length > 600 ||
        (language !== "en" && language !== "zh-CN") ||
        (includeHoldingNames !== "true" && includeHoldingNames !== "false")
      ) return errorResponse("Image question is invalid.", 400);
      const checked = await checkedImages(form.getAll("images"));
      if (checked instanceof Response) return checked;
      const stored = conversationId
        ? input.conversations.readPortfolioAnalystConversation(conversationId)
        : undefined;
      if (conversationId && !stored) return errorResponse("Conversation was not found.", 404);
      if (conversationId && input.conversations.readLatestPortfolioAnalystConversation()?.id !== conversationId) {
        return errorResponse("Only the current conversation can receive images.", 409);
      }
      if (stored && (stored.provider !== "openai" || stored.includeHoldingNames !== (includeHoldingNames === "true"))) {
        return errorResponse("Conversation settings changed. Reset the conversation before continuing.", 409);
      }

      const now = new Date().toISOString();
      const createId = input.createId ?? randomUUID;
      const conversation = stored && normalizePortfolioAnalystConversation(stored)
        || createPortfolioAnalystConversation({
          id: createId(), provider: "openai", language,
          includeHoldingNames: includeHoldingNames === "true", now,
        });
      const saved: PortfolioAnalystImageAttachment[] = [];
      try {
        for (const image of checked) {
          const attachment: PortfolioAnalystImageAttachment = {
            id: createId(), mimeType: image.mimeType, byteLength: image.bytes.byteLength,
          };
          await input.images.save(attachment, image.bytes);
          saved.push(attachment);
        }
        const next = appendPortfolioAnalystTurn({ ...conversation, language }, {
          id: createId(),
          question: userText || "Explain the attached screenshots.",
          userText,
          attachments: saved,
          createdAt: now,
          imageAnswer: {
            status: "pending",
            text: "",
            uncertainties: [],
            provider: "openai",
            model: input.imageModel,
            generatedAt: now,
          },
        });
        input.conversations.savePortfolioAnalystConversation(next);
        return Response.json({ conversation: next }, { headers: { "cache-control": "no-store" } });
      } catch {
        await Promise.allSettled(saved.map((attachment) => input.images.delete(attachment)));
        return errorResponse("Image message could not be saved locally.", 500);
      }
    },

    async COMPLETE(turnId: string, request: Request, onAnswerTextDelta?: (delta: string) => void) {
      if (!input.imageQuestion) return errorResponse("Image questions are not configured.", 503);
      const conversation = input.conversations.readLatestPortfolioAnalystConversation();
      const turn = conversation?.turns.find((item) => item.id === turnId);
      if (!conversation || !turn?.imageAnswer || !turn.attachments?.length) {
        return errorResponse("Image message was not found.", 404);
      }
      if (turn.imageAnswer.status === "complete" || !turn.imageAnswer.status) {
        return Response.json({ conversation }, { headers: { "cache-control": "no-store" } });
      }
      let loaded: Array<{ mimeType: PortfolioAnalystImageAttachment["mimeType"]; bytes: Uint8Array | undefined }>;
      try {
        loaded = await Promise.all(turn.attachments.map(async (attachment) => ({
          mimeType: attachment.mimeType,
          bytes: await input.images.read(attachment),
        })));
      } catch {
        return errorResponse("An attached image could not be read.", 500);
      }
      if (loaded.some((image) => !image.bytes)) {
        return errorResponse("An attached image could not be found.", 404);
      }
      const images: ImageQuestionInput["images"] = loaded.map((image) => ({
        mimeType: image.mimeType,
        bytes: image.bytes!,
      }));
      let answer: ImageQuestionAnswer;
      try {
        answer = await input.imageQuestion({
          question: turn.userText ?? turn.question,
          language: conversation.language,
          images,
          signal: request.signal,
          onAnswerTextDelta,
        });
      } catch {
        if (request.signal.aborted) return errorResponse("Image analysis was interrupted.", 499);
        const latest = input.conversations.readPortfolioAnalystConversation(conversation.id);
        if (!latest?.turns.some((item) => item.id === turnId && item.imageAnswer)) {
          return errorResponse("Image message was removed.", 404);
        }
        const failed = {
          ...latest,
          turns: latest.turns.map((item) => item.id === turnId && item.imageAnswer
            ? { ...item, imageAnswer: { ...item.imageAnswer, status: "failed" as const } }
            : item),
        };
        input.conversations.savePortfolioAnalystConversation(failed);
        return Response.json({ conversation: failed, error: "The image could not be analyzed. Try again." }, {
          headers: { "cache-control": "no-store" },
        });
      }
      const latest = input.conversations.readPortfolioAnalystConversation(conversation.id);
      if (!latest?.turns.some((item) => item.id === turnId && item.imageAnswer)) {
        return errorResponse("Image message was removed.", 404);
      }
      const completed = {
        ...latest,
        turns: latest.turns.map((item) => item.id === turnId && item.imageAnswer
          ? { ...item, imageAnswer: {
              ...item.imageAnswer,
              status: "complete" as const,
              text: answer.answer,
              uncertainties: answer.uncertainties,
              generatedAt: new Date().toISOString(),
            } }
          : item),
      };
      input.conversations.savePortfolioAnalystConversation(completed);
      return Response.json({ conversation: completed }, { headers: { "cache-control": "no-store" } });
    },

    async GET(id: string) {
      const conversation = input.conversations.readLatestPortfolioAnalystConversation();
      const attachment = conversation?.turns.flatMap((turn) => turn.attachments ?? [])
        .find((item) => item.id === id);
      if (!attachment) return errorResponse("Image was not found.", 404);
      try {
        const bytes = await input.images.read(attachment);
        if (!bytes) return errorResponse("Image was not found.", 404);
        return new Response(new Uint8Array(bytes).buffer, {
          headers: {
            "content-type": attachment.mimeType,
            "content-disposition": "inline",
            "content-length": String(bytes.byteLength),
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch {
        return errorResponse("Image could not be read.", 500);
      }
    },
  };
}
