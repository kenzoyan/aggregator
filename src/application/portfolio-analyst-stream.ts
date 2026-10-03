import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystToolActivity } from "@/application/portfolio-analyst-agent";

export const portfolioAnalystStreamContentType = "application/x-ndjson";

export type PortfolioAnalystStreamPhase =
  | "selecting-tool"
  | "reading-current-facts"
  | "generating-answer";

export type PortfolioAnalystStreamEvent =
  | { type: "accepted"; question: string }
  | { type: "status"; phase: PortfolioAnalystStreamPhase }
  | { type: "tool-activity"; activity: PortfolioAnalystToolActivity }
  | { type: "answer-delta"; delta: string }
  | { type: "completed"; conversation: PortfolioAnalystConversation }
  | { type: "failed"; error: string; code?: string };

export interface PendingPortfolioAnalystTurn {
  question: string;
  answerText: string;
  activities: PortfolioAnalystToolActivity[];
  statusHistory: PortfolioAnalystStreamPhase[];
  failureCode?: string;
  phase:
    | "sending"
    | "selecting-tool"
    | "reading-current-facts"
    | "generating-answer"
    | "stopped"
    | "failed";
}

export function beginPendingPortfolioAnalystTurn(
  question: string,
): PendingPortfolioAnalystTurn {
  return {
    question,
    answerText: "",
    activities: [],
    statusHistory: [],
    phase: "sending",
  };
}

export function applyPortfolioAnalystStreamEvent(
  pending: PendingPortfolioAnalystTurn,
  event: PortfolioAnalystStreamEvent,
): PendingPortfolioAnalystTurn {
  switch (event.type) {
    case "accepted":
      return { ...pending, question: event.question };
    case "status":
      return {
        ...pending,
        phase: event.phase,
        statusHistory: pending.statusHistory.includes(event.phase)
          ? pending.statusHistory
          : [...pending.statusHistory, event.phase],
      };
    case "tool-activity":
      return { ...pending, activities: [...pending.activities, event.activity] };
    case "answer-delta":
      return {
        ...pending,
        phase: "generating-answer",
        answerText: pending.answerText + event.delta,
      };
    case "completed":
      return pending;
    case "failed":
      return { ...pending, answerText: "", phase: "failed", failureCode: event.code };
  }
}

export async function consumePortfolioAnalystStream(
  response: Response,
  onEvent: (event: PortfolioAnalystStreamEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("Portfolio Analyst stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as PortfolioAnalystStreamEvent);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as PortfolioAnalystStreamEvent);
}
