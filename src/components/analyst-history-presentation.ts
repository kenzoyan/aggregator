import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";

export const initialVisibleHistoryCount = 24;

export function analystHistoryEntries(conversation: PortfolioAnalystConversation) {
  return [
    ...conversation.turns.map((turn) => ({ kind: "turn" as const, id: turn.id, at: turn.createdAt, turn })),
    ...conversation.importActivities.map((activity) => ({ kind: "import" as const, id: `import-${activity.draftId}`, at: activity.createdAt, activity })),
    ...conversation.importActivities.flatMap((activity) => (activity.followUps ?? []).map((followUp) => ({
      kind: "import-follow-up" as const, id: `follow-up-${followUp.id}`, at: followUp.createdAt, followUp,
    }))),
  ].toSorted((left, right) => left.at.localeCompare(right.at));
}

export function analystHistoryDay(at: string) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function analystHistoryDateLabel(at: string, language: "en" | "zh-CN") {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-GB", {
    timeZone: "Europe/Helsinki", month: "short", day: "numeric", year: "numeric",
  }).format(date);
}
