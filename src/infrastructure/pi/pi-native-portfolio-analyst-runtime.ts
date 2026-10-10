import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Message, Model } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

import type { PortfolioAnalystAgentRuntime } from "@/application/portfolio-analyst-agent";
import type { WebResearch } from "@/application/portfolio-web-research";
import { createPiModelControlledPortfolioAnalyst } from "@/infrastructure/pi/pi-model-controlled-portfolio-analyst";

export function portfolioAnalystOutputTokenLimit(messages: readonly Message[]) {
  return messages.some((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((part) => part.type === "image")) || messages.some((message) => message.role === "toolResult" && message.toolName === "read_all_holdings" && !message.isError)
    ? 8_000 : 1_100;
}

function fallbackModel(modelId: string): Model<any> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: /^gpt-[56]/.test(modelId),
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 8_000,
  };
}

export function createPiNativePortfolioAnalystRuntime(input: {
  model: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  webResearch?: WebResearch;
}): PortfolioAnalystAgentRuntime {
  const provider = openaiProvider();
  const model = provider.getModels().find((candidate) => candidate.id === input.model) ??
    fallbackModel(input.model);
  const streamFn: StreamFn = (_model, context, options) => provider.streamSimple(
    model as Model<"openai-responses">,
    context,
    {
      ...options,
      apiKey: input.apiKey,
      fetch: input.fetch,
      maxTokens: portfolioAnalystOutputTokenLimit(context.messages),
      timeoutMs: 60_000,
      cacheRetention: "none",
    },
  );
  return createPiModelControlledPortfolioAnalyst({ model, streamFn, webResearch: input.webResearch });
}
