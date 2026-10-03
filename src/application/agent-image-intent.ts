import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { importChannelForReport } from "@/application/imports/import-channel";

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

export function requestsScreenshotImport(text: string, importFlowActive: boolean): boolean {
  const explicitImport = /\b(import|update|replace|sync|add)\b.{0,50}\b(holdings?|assets?|portfolio|account)\b|\b(holdings?|assets?|portfolio|account)\b.{0,50}\b(import|update|replace|sync|add)\b|(?:导入|更新|同步|添加).{0,20}(?:资产|持仓|账户|投资组合)|(?:资产|持仓|账户|投资组合).{0,20}(?:导入|更新|同步|添加)/i.test(text);
  if (explicitImport) return true;
  if (/\b(explain|describe)\b|\bwhat(?:'s| is| does)\b.{0,40}\b(image|picture|screenshot|photo)\b|(?:解释|说明|看懂|分析一下).{0,20}(?:图片|截图|照片)/i.test(text)) return false;
  return importFlowActive;
}
