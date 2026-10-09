import type { PortfolioAnalystConversation, PortfolioAnalystConversationStore } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystAgentAudit } from "@/application/portfolio-analyst-agent";
import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";

export type WorkflowReplyGenerator = (conversation: PortfolioAnalystConversation, result: PortfolioWorkflowResult, signal: AbortSignal) => Promise<{ text: string; audit: PortfolioAnalystAgentAudit }>;
export async function completePortfolioWorkflowReply(input: {
  conversations: PortfolioAnalystConversationStore; conversation: PortfolioAnalystConversation;
  turnId: string; generate: WorkflowReplyGenerator; signal: AbortSignal;
}) {
  const turn = input.conversation.turns.find((item) => item.id === input.turnId);
  if (!turn?.chat?.workflowResult) throw new Error("Operation result was not found.");
  if (turn.chat.assistantText && turn.chat.requestStatus !== "pending") return { conversation: input.conversation };
  try {
    const reply = await input.generate(input.conversation, turn.chat.workflowResult, input.signal);
    input.signal.throwIfAborted();
    if (!reply.text.trim() || reply.text.length > 6000) throw new Error("Invalid Agent reply.");
    const latest = input.conversations.readPortfolioAnalystConversation(input.conversation.id);
    if (!latest || input.conversations.readLatestPortfolioAnalystConversation()?.id !== latest.id) throw new Error("Conversation changed.");
    const target = latest.turns.find((item) => item.id === input.turnId);
    if (JSON.stringify(target?.chat?.workflowResult) !== JSON.stringify(turn.chat.workflowResult)) throw new Error("Operation result changed.");
    const conversation = { ...latest, turns: latest.turns.map((item) => {
      if (item.id !== input.turnId || !item.chat) return item;
      const { requestStatus: _status, failureCode: _failure, ...chat } = item.chat;
      return { ...item, chat: { ...chat, assistantText: reply.text, workflowReplyAudit: reply.audit } };
    }) };
    input.conversations.savePortfolioAnalystConversation(conversation);
    return { conversation };
  } catch {
    // The operation has already been stored. Reply failure never retries or undoes it.
    return { conversation: input.conversations.readPortfolioAnalystConversation(input.conversation.id) ?? input.conversation,
      replyUnavailable: true, replyTurnId: input.turnId };
  }
}
