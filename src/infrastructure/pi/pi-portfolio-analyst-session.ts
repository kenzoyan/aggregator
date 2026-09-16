import {
  Agent,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";

import { portfolioAnalystAnswerCandidateSchema } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystHistoryMessage } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystProvider } from "@/application/portfolio-analyst-provider";
import type {
  PortfolioAnalystSession,
  PortfolioAnalystSessionFactory,
  PortfolioAnalystSessionTurn,
} from "@/application/portfolio-analyst-session";

const emptyUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function textOf(message: AgentMessage | undefined): string {
  if (!message || !("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function assistantHistoryMessage(message: PortfolioAnalystHistoryMessage): AgentMessage {
  if (message.role === "user") {
    return { role: "user", content: message.text, timestamp: 0 };
  }
  return {
    role: "assistant",
    content: [{
      type: "text",
      text: JSON.stringify({ historicalAnswer: message.text, factsAsOf: message.factsAsOf }),
    }],
    api: "portfolio-analyst",
    provider: "local-history",
    model: "local-history",
    usage: emptyUsage,
    stopReason: "stop",
    timestamp: 0,
  };
}

function historicalMessage(message: AgentMessage): PortfolioAnalystHistoryMessage | undefined {
  if (message.role === "user") {
    return { role: "user", text: textOf(message) };
  }
  if (message.role !== "assistant" || message.provider !== "local-history") {
    return undefined;
  }
  try {
    const value = JSON.parse(textOf(message)) as {
      historicalAnswer?: unknown;
      factsAsOf?: unknown;
    };
    return typeof value.historicalAnswer === "string" && typeof value.factsAsOf === "string"
      ? { role: "assistant", text: value.historicalAnswer, factsAsOf: value.factsAsOf }
      : undefined;
  } catch {
    return undefined;
  }
}

function generationTurnFromPiContext(
  context: Context,
  signal?: AbortSignal,
  onAnswerTextDelta?: (delta: string) => void,
) {
  const currentQuestionIndex = context.messages.findLastIndex(
    (message) => message.role === "user",
  );
  const currentQuestion = context.messages[currentQuestionIndex];
  if (!currentQuestion) throw new Error("Pi session has no current user question.");
  return {
    question: textOf(currentQuestion),
    history: context.messages
      .slice(0, currentQuestionIndex)
      .map((message) => historicalMessage(message))
      .filter((message): message is PortfolioAnalystHistoryMessage => Boolean(message)),
    signal,
    onAnswerTextDelta,
  };
}

function createModel(provider: PortfolioAnalystProvider): Model<any> {
  return {
    id: provider.model,
    name: provider.model,
    api: "portfolio-analyst",
    provider: provider.id,
    baseUrl: "local-adapter",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 1_100,
  };
}

function createAssistantMessage(
  provider: PortfolioAnalystProvider,
  content: string,
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: content ? [{ type: "text", text: content }] : [],
    api: "portfolio-analyst",
    provider: provider.id,
    model: provider.model,
    usage: emptyUsage,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

class PiPortfolioAnalystSession implements PortfolioAnalystSession {
  constructor(private readonly provider: PortfolioAnalystProvider) {}

  async runTurn(input: PortfolioAnalystSessionTurn) {
    let providerFailure: unknown;
    const streamFn: StreamFn = (_model, piContext, options) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const pending = createAssistantMessage(this.provider, "", "pending");
        stream.push({ type: "start", partial: pending });
        try {
          const answer = await this.provider.generate(
            input.context,
            generationTurnFromPiContext(
              piContext,
              options?.signal,
              input.onAnswerTextDelta,
            ),
          );
          const text = JSON.stringify(answer);
          const message = createAssistantMessage(this.provider, text, "stop");
          stream.push({ type: "text_start", contentIndex: 0, partial: pending });
          pending.content = [{ type: "text", text }];
          stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: pending });
          stream.push({ type: "text_end", contentIndex: 0, content: text, partial: pending });
          stream.push({ type: "done", reason: "stop", message });
          stream.end(message);
        } catch (error) {
          providerFailure = error;
          const message = createAssistantMessage(
            this.provider,
            "",
            options?.signal?.aborted ? "aborted" : "error",
            options?.signal?.aborted ? "Request was aborted" : "Provider generation failed",
          );
          stream.push({
            type: "error",
            reason: options?.signal?.aborted ? "aborted" : "error",
            error: message,
          });
          stream.end(message);
        }
      })();
      return stream;
    };

    const agent = new Agent({
      initialState: {
        model: createModel(this.provider),
        systemPrompt: "Portfolio Analyst conversation adapter",
        messages: input.history.map(assistantHistoryMessage),
        tools: [],
      },
      streamFn,
      shouldStopAfterTurn: () => true,
    });
    const abort = () => agent.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      await agent.prompt(input.question);
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
    if (providerFailure) throw providerFailure;
    if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
    const latest = [...agent.state.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    return portfolioAnalystAnswerCandidateSchema.parse(JSON.parse(textOf(latest)));
  }
}

export const piPortfolioAnalystSessionFactory: PortfolioAnalystSessionFactory = {
  create(provider) {
    return new PiPortfolioAnalystSession(provider);
  },
};
