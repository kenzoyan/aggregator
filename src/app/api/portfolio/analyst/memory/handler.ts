import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  resolvePortfolioAnalystMemoryProposal,
  type PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";
import {
  MAX_PORTFOLIO_ANALYST_MEMORIES,
  MAX_PORTFOLIO_ANALYST_MEMORY_CHARS,
  validMemoryContent,
  type PortfolioAnalystMemoryStore,
} from "@/application/portfolio-analyst-memory";
import { getPortfolioDatabase } from "@/server/portfolio-db";

const saveSchema = z.object({
  id: z.string().uuid().or(z.literal("migrated-answer-order")).optional(),
  content: z.string().trim().min(1).max(MAX_PORTFOLIO_ANALYST_MEMORY_CHARS),
  source: z.enum(["chat", "settings"]),
  confirm: z.literal(true),
}).strict();
const deleteSchema = z.object({
  id: z.string().uuid().or(z.literal("migrated-answer-order")),
  confirm: z.literal(true),
}).strict();
const proposalSchema = z.object({
  conversationId: z.string().trim().min(1).max(80),
  turnId: z.string().trim().min(1).max(80),
  confirm: z.literal(true),
}).strict();
const cancelSchema = z.object({
  conversationId: z.string().trim().min(1).max(80),
  turnId: z.string().trim().min(1).max(80),
  action: z.literal("cancel"),
}).strict();

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function createPortfolioAnalystMemoryHandlers(
  store: PortfolioAnalystMemoryStore & Partial<PortfolioAnalystConversationStore>,
  now: () => string = () => new Date().toISOString(),
  createId: () => string = randomUUID,
) {
  return {
    GET() { return json({ memories: store.listPortfolioAnalystMemories() }); },
    async PUT(request: Request) {
      const body = await request.json().catch(() => undefined);
      const proposal = proposalSchema.safeParse(body);
      if (proposal.success) {
        const conversation = store.readPortfolioAnalystConversation?.(proposal.data.conversationId);
        if (!conversation || store.readLatestPortfolioAnalystConversation?.()?.id !== conversation.id) {
          return json({ error: "Current conversation was not found." }, 404);
        }
        const turn = conversation.turns.find((item) => item.id === proposal.data.turnId);
        if (!turn?.chat?.memoryProposal || turn.chat.memoryProposal.status !== "pending") {
          return json({ error: "Pending memory proposal was not found." }, 409);
        }
        if (!validMemoryContent(turn.chat.memoryProposal.content)) return json({ error: "Memory content is invalid." }, 400);
        if (store.listPortfolioAnalystMemories().length >= MAX_PORTFOLIO_ANALYST_MEMORIES) {
          return json({ error: "The memory list is full. Edit or delete one first." }, 409);
        }
        const timestamp = now();
        const memory = {
          id: turn.id, content: turn.chat.memoryProposal.content, source: "chat" as const,
          createdAt: timestamp, updatedAt: timestamp,
        };
        store.savePortfolioAnalystMemory(memory);
        const updated = resolvePortfolioAnalystMemoryProposal(conversation, turn.id, "saved", timestamp);
        store.savePortfolioAnalystConversation?.(updated);
        return json({ memory, conversation: updated });
      }
      const parsed = saveSchema.safeParse(body);
      if (!parsed.success || !validMemoryContent(parsed.data.content)) {
        return json({ error: "Confirm a short preference without secrets or account facts." }, 400);
      }
      const existing = parsed.data.id ? store.readPortfolioAnalystMemory(parsed.data.id) : undefined;
      if (parsed.data.id && !existing) return json({ error: "Memory was not found." }, 404);
      if (!existing && store.listPortfolioAnalystMemories().length >= MAX_PORTFOLIO_ANALYST_MEMORIES) {
        return json({ error: "The memory list is full. Edit or delete one first." }, 409);
      }
      const timestamp = now();
      const memory = {
        id: existing?.id ?? createId(), content: parsed.data.content, source: parsed.data.source,
        createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
      };
      store.savePortfolioAnalystMemory(memory);
      return json({ memory });
    },
    async PATCH(request: Request) {
      const parsed = cancelSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return json({ error: "Memory cancellation request is invalid." }, 400);
      const conversation = store.readPortfolioAnalystConversation?.(parsed.data.conversationId);
      if (!conversation || store.readLatestPortfolioAnalystConversation?.()?.id !== conversation.id) {
        return json({ error: "Current conversation was not found." }, 404);
      }
      const turn = conversation.turns.find((item) => item.id === parsed.data.turnId);
      if (!turn?.chat?.memoryProposal || turn.chat.memoryProposal.status !== "pending") {
        return json({ error: "Pending memory proposal was not found." }, 409);
      }
      const updated = resolvePortfolioAnalystMemoryProposal(conversation, turn.id, "cancelled", now());
      store.savePortfolioAnalystConversation?.(updated);
      return json({ conversation: updated });
    },
    async DELETE(request: Request) {
      const parsed = deleteSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return json({ error: "Confirm memory deletion." }, 400);
      if (!store.readPortfolioAnalystMemory(parsed.data.id)) return json({ error: "Memory was not found." }, 404);
      store.deletePortfolioAnalystMemory(parsed.data.id);
      return json({ deleted: true });
    },
  };
}

export function GET() { return createPortfolioAnalystMemoryHandlers(getPortfolioDatabase()).GET(); }
export function PUT(request: Request) { return createPortfolioAnalystMemoryHandlers(getPortfolioDatabase()).PUT(request); }
export function PATCH(request: Request) { return createPortfolioAnalystMemoryHandlers(getPortfolioDatabase()).PATCH(request); }
export function DELETE(request: Request) { return createPortfolioAnalystMemoryHandlers(getPortfolioDatabase()).DELETE(request); }
