import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";

export interface PendingAgentAction {
  key: string;
  kind: "import" | "sale" | "memory";
  id: string;
  label?: string;
  createdAt: string;
}

// Saved business state is authoritative; old assistant messages cannot reopen finished work.
export function pendingAgentActions(
  conversation: PortfolioAnalystConversation | undefined,
  drafts: Record<string, ImportDraftReadModel>,
): PendingAgentAction[] {
  if (!conversation) return [];
  const actions: PendingAgentAction[] = [];
  for (const activity of conversation.importActivities) {
    if (activity.cancelledAt || drafts[activity.draftId]?.status !== "draft") continue;
    actions.push({ key: `import:${activity.draftId}`, kind: "import", id: activity.draftId,
      label: activity.targetLabel, createdAt: activity.followUps?.at(-1)?.createdAt ?? activity.createdAt });
  }
  for (const turn of conversation.turns) {
    if (turn.chat?.saleDraft?.status === "pending") {
      actions.push({ key: `sale:${turn.id}`, kind: "sale", id: turn.id,
        label: [turn.chat.saleDraft.extraction?.accountName, turn.chat.saleDraft.extraction?.name].filter(Boolean).join(" · ") || undefined, createdAt: turn.createdAt });
    }
    if (turn.chat?.memoryProposal?.status === "pending") {
      actions.push({ key: `memory:${turn.id}`, kind: "memory", id: turn.id, label: turn.chat.memoryProposal.content.length > 48
        ? `${turn.chat.memoryProposal.content.slice(0, 48)}…` : turn.chat.memoryProposal.content, createdAt: turn.createdAt });
    }
  }
  return actions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function currentAgentAction(actions: PendingAgentAction[], selectedKey?: string) {
  return actions.find((action) => action.key === selectedKey) ?? actions[0];
}
