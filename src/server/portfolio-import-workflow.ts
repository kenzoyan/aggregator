import { randomUUID } from "node:crypto";
import { appendPortfolioAnalystTurn } from "@/application/portfolio-analyst-conversation";
import { createImportWorkflowResult } from "@/application/imports/import-workflow-result";
import { completePortfolioWorkflowReply } from "@/application/portfolio-workflow-reply";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";

/** Records the outcome after the application has handled explicit import confirmation. */
export async function replyToImportConfirmation(database: PortfolioDatabase, draftId: string, signal: AbortSignal, error?: string) {
  const conversation = database.readLatestPortfolioAnalystConversation();
  const activity = conversation?.importActivities.find((item) => item.draftId === draftId);
  const draft = database.getImportDraft(draftId);
  if (!conversation || !activity || !draft) return {};
  const success = !error && draft.status === "confirmed";
  const prior = success && conversation.turns.findLast((turn) => turn.chat?.workflowResult?.workflow === "import" &&
    turn.chat.workflowResult.operation === "save" && turn.chat.workflowResult.status === "succeeded" && turn.chat.workflowResult.importDraft?.id === draftId);
  if (prior) return { conversation };
  const now = new Date().toISOString();
  const turnId = randomUUID();
  const result = createImportWorkflowResult({ draft, accountName: activity.targetLabel, operation: "save",
    status: success ? "succeeded" : "failed", portfolioChanged: success, recordedAt: now, details: error });
  const next = appendPortfolioAnalystTurn(conversation, { id: turnId, question: "", createdAt: now,
    chat: { assistantText: "", requestStatus: "pending", workflowResult: result } });
  database.savePortfolioAnalystConversation(next);
  return completePortfolioWorkflowReply({ conversations: database, conversation: next, turnId,
    generate: createPortfolioWorkflowReply(database), signal });
}
