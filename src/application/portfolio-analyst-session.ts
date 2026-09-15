import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystHistoryMessage } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystProvider } from "@/application/portfolio-analyst-provider";

export interface PortfolioAnalystSessionTurn {
  context: PortfolioAnalystContextV1;
  question: string;
  history: PortfolioAnalystHistoryMessage[];
  signal?: AbortSignal;
  onAnswerTextDelta?: (delta: string) => void;
}

export interface PortfolioAnalystSession {
  runTurn(input: PortfolioAnalystSessionTurn): Promise<PortfolioAnalystAnswer>;
}

export interface PortfolioAnalystSessionFactory {
  create(provider: PortfolioAnalystProvider): PortfolioAnalystSession;
}
