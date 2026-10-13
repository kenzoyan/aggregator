import { getAIEnvironment } from "@/server/ai-provider-settings";
import { createPortfolioImageReply } from "@/server/portfolio-image-reply";
import { createPortfolioAnalystImageHandlers } from "../../handler";

import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { createOpenAIImageQuestion } from "@/infrastructure/openai/openai-image-question";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ turnId: string }> },
) {
  const environment = getAIEnvironment();
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "OpenAI image analysis is not configured." }, { status: 503 });
  }
  const model = environment.OPENAI_IMAGE_QUESTION_MODEL?.trim()
    || environment.OPENAI_IMAGE_IMPORT_MODEL?.trim()
    || getPortfolioAnalystProviderRegistry().models.openai;
  const { turnId } = await context.params;
  const handlers = createPortfolioAnalystImageHandlers({
    conversations: getPortfolioDatabase(),
    images: createLocalPortfolioAnalystImageStore(),
    imageQuestion: createOpenAIImageQuestion({ apiKey, model }),
    imageModel: model,
    replyToImage: createPortfolioImageReply(getPortfolioDatabase()),
  });
  if (request.headers.get("accept") !== "application/x-ndjson") {
    return handlers.COMPLETE(turnId, request);
  }
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      let open = true;
      const emit = (event: object) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
        catch { open = false; }
      };
      void handlers.COMPLETE(turnId, request, (delta) => emit({ type: "delta", delta }))
        .then(async (response) => {
          const body = await response.json() as { conversation?: unknown; error?: string };
          if (response.ok && body.conversation) {
            emit({ type: "completed", conversation: body.conversation, ...(body.error ? { error: body.error } : {}) });
          } else {
            emit({ type: "failed", error: body.error ?? "The image response could not be completed." });
          }
        })
        .catch(() => emit({ type: "failed", error: "The image response could not be completed." }))
        .finally(() => {
          if (!open) return;
          open = false;
          controller.close();
        });
    },
  }), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
