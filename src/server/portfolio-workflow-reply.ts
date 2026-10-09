import { createPortfolioAnalystHistory, type PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { readPortfolioOverviewIncludingEmpty } from "@/server/current-portfolio";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

export function createPortfolioWorkflowReply(database: PortfolioDatabase) {
  return async (conversation: PortfolioAnalystConversation, workflowResult: PortfolioWorkflowResult, signal: AbortSignal) => {
    const runtime = getPortfolioAnalystProviderRegistry().agentRuntimes.openai;
    if (!runtime) throw new Error("Agent reply is not configured.");
    const portfolio = readPortfolioOverviewIncludingEmpty(database, new Date().toISOString());
    const latestUser = conversation.turns.findLast((turn) => Boolean(turn.userText || turn.question));
    const userText = latestUser?.userText ?? latestUser?.question;
    const result = await runtime.runTurn({
      question: userText || "Explain the recorded workflow result.",
      history: createPortfolioAnalystHistory(conversation),
      tools: createPortfolioAnalystTools(portfolio, database.readSourceAccounts(), database.readPortfolioFacts()),
      language: conversation.language, includeHoldingNames: true, defaultPeriod: "week",
      memories: database.listPortfolioAnalystMemories(), workflowResult, signal,
    });
    if (result.kind !== "conversation" || !result.audit.toolCalls.some((call) =>
      call.name === "read_workflow_result" && call.status === "completed")) {
      throw new Error("Agent did not read the operation result.");
    }
    return { text: result.reply, audit: result.audit };
  };
}
