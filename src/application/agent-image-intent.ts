import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { importChannelForReport } from "@/application/imports/import-channel";

export interface AgentImageIntentInput {
  text: string;
  importFlowActive: boolean;
  stage: "intent" | "account" | "image-follow-up" | "import-follow-up";
  preferredAccountType?: string;
  accounts: Array<{ id: string; label: string; accountType: string }>;
}

export interface AgentImageIntentDecision {
  intent: "answer-image" | "prepare-import" | "prepare-sale" | "clarify" | "delegate";
  confidence: "high" | "low";
  accountId?: string | null;
}

export function resumableImageContext(conversation?: PortfolioAnalystConversation): {
  sourceTurnId: string;
  stage: "image-follow-up" | "import-follow-up";
  preferredAccountType?: string;
} | undefined {
  const latest = conversation?.turns.at(-1);
  if (!conversation || !latest) return undefined;
  const target = pendingScreenshotImportTarget(conversation);
  if (!latest.imageAnswer || latest.imageAnswer.status !== "complete") {
    if (!latest.report) return undefined;
    const sourceIndex = conversation.turns.findLastIndex((turn) => Boolean(turn.attachments?.length));
    const source = conversation.turns[sourceIndex];
    if (!source) return undefined;
    if (!target) {
      if (conversation.turns.length - sourceIndex > 7 ||
        conversation.importActivities.some((activity) => activity.createdAt >= source.createdAt)) return undefined;
      return { sourceTurnId: source.id, stage: "image-follow-up" };
    }
    const related = conversation.turns.slice(sourceIndex + 1).every((turn) => {
      if (turn.imageAnswer) return turn.imageAnswer.status === "complete"
        && turn.imageAnswer.sourceTurnId === source.id;
      if (turn.report) return turn.report.answer.proposedUpdate?.kind === "start-account-import"
        && importChannelForReport(turn.report) === "screenshot"
        && turn.report.answer.proposedUpdate.accountType === target.accountType;
      return Boolean(turn.chat?.imageAction?.sourceTurnId === source.id);
    });
    if (!related || conversation.importActivities.some((activity) => activity.createdAt >= source.createdAt)) return undefined;
    return { sourceTurnId: source.id, stage: "import-follow-up", preferredAccountType: target.accountType };
  }
  const source = latest.imageAnswer.sourceTurnId
    ? conversation.turns.find((turn) => turn.id === latest.imageAnswer?.sourceTurnId)
    : latest;
  if (!source?.attachments?.length || conversation.importActivities.some((activity) => activity.createdAt >= source.createdAt)) {
    return undefined;
  }
  return { sourceTurnId: source.id, stage: "image-follow-up" };
}

export function pendingScreenshotImportTarget(conversation?: PortfolioAnalystConversation) {
  const latestTurn = conversation?.turns.at(-1);
  const routedTurn = latestTurn?.importImage
    ? conversation?.turns.find((turn) => turn.id === latestTurn.importImage?.sourceTurnId)
    : latestTurn;
  if (!routedTurn?.report) return undefined;
  const action = routedTurn.report.answer.proposedUpdate;
  if (action?.kind !== "start-account-import" || importChannelForReport(routedTurn.report) !== "screenshot") return undefined;
  const latestImport = conversation?.importActivities.at(-1);
  return latestImport && latestImport.createdAt >= routedTurn.createdAt ? undefined : action;
}
