import { z } from "zod";
import { completePortfolioWorkflowReply, type WorkflowReplyGenerator } from "@/application/portfolio-workflow-reply";
import type { PortfolioAnalystConversationStore } from "@/application/portfolio-analyst-conversation";
const schema = z.object({ conversationId: z.string().min(1).max(80), turnId: z.string().min(1).max(80) }).strict();
export function createWorkflowReplyHandler(input: { conversations: PortfolioAnalystConversationStore; generate: WorkflowReplyGenerator }) {
  return async (request: Request) => {
    let parsed: z.infer<typeof schema>;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 2048) return Response.json({ code: "invalid-request" }, { status: 400 });
      parsed = schema.parse(JSON.parse(raw));
    } catch { return Response.json({ code: "invalid-request" }, { status: 400 }); }
    const conversation = input.conversations.readPortfolioAnalystConversation(parsed.conversationId);
    if (!conversation || input.conversations.readLatestPortfolioAnalystConversation()?.id !== conversation.id) return Response.json({ code: "conversation-not-found" }, { status: 404 });
    if (!conversation.turns.some((turn) => turn.id === parsed.turnId && turn.chat?.workflowResult)) return Response.json({ code: "result-not-found" }, { status: 404 });
    return Response.json(await completePortfolioWorkflowReply({
      conversations: input.conversations, conversation, turnId: parsed.turnId, generate: input.generate, signal: request.signal,
    }), { headers: { "cache-control": "no-store" } });
  };
}
