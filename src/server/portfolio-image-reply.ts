import type { ImageReplyGenerator } from "@/app/api/portfolio/analyst/images/handler";
import { createPortfolioAnalystHistory } from "@/application/portfolio-analyst-conversation";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { readPortfolioOverviewIncludingEmpty } from "@/server/current-portfolio";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

export function createPortfolioImageReply(database: PortfolioDatabase): ImageReplyGenerator {
  return async ({ conversation, question, read, signal, onAnswerTextDelta }) => {
    const runtime = getPortfolioAnalystProviderRegistry().agentRuntimes.openai;
    if (!runtime) throw new Error("Agent reply is not configured.");
    const portfolio = readPortfolioOverviewIncludingEmpty(database, new Date().toISOString());
    const result = await runtime.runTurn({
      question: question || "Explain the attached screenshots.",
      history: createPortfolioAnalystHistory(conversation),
      tools: createPortfolioAnalystTools(portfolio, database.readSourceAccounts(), database.readPortfolioFacts()),
      language: conversation.language, includeHoldingNames: true, defaultPeriod: "week",
      memories: database.listPortfolioAnalystMemories(), imageAnalysis: { read }, signal, onAnswerTextDelta,
    });
    if (result.kind !== "conversation" || !result.audit.toolCalls.some((call) => call.name === "read_image" && call.status === "completed")) {
      throw new Error("Agent did not read the image observations.");
    }
    return { text: result.reply, audit: result.audit, model: getPortfolioAnalystProviderRegistry().models.openai };
  };
}
