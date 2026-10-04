import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

import type { PortfolioAnalystAgentRuntime } from "@/application/portfolio-analyst-agent";
import type { PortfolioAnalystProviderId } from "@/application/portfolio-analyst-provider";
import type { WebResearch } from "@/application/portfolio-web-research";
import { createPiModelControlledPortfolioAnalyst } from "@/infrastructure/pi/pi-model-controlled-portfolio-analyst";

function fallbackModel(
  provider: PortfolioAnalystProviderId,
  modelId: string,
): Model<any> {
  return {
    id: modelId,
    name: modelId,
    api: provider === "openai" ? "openai-responses" : "openai-completions",
    provider,
    baseUrl: provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://api.deepseek.com",
    reasoning: provider === "openai" && /^gpt-[56]/.test(modelId),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 1_100,
  };
}

export function createPiNativePortfolioAnalystRuntime(input: {
  provider: PortfolioAnalystProviderId;
  model: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  webResearch?: WebResearch;
}): PortfolioAnalystAgentRuntime {
  if (input.provider === "openai") {
    const provider = openaiProvider();
    const model = provider.getModels().find((candidate) => candidate.id === input.model) ??
      fallbackModel(input.provider, input.model);
    const streamFn: StreamFn = (_model, context, options) => provider.streamSimple(
      model as Model<"openai-responses">,
      context,
      {
        ...options,
        apiKey: input.apiKey,
        fetch: input.fetch,
        maxTokens: 1_100,
        timeoutMs: 30_000,
        cacheRetention: "none",
      },
    );
    return createPiModelControlledPortfolioAnalyst({ model, streamFn, webResearch: input.webResearch });
  }

  const provider = deepseekProvider();
  const model = provider.getModels().find((candidate) => candidate.id === input.model) ??
    fallbackModel(input.provider, input.model);
  const streamFn: StreamFn = (_model, context, options) => provider.streamSimple(
    model as Model<"openai-completions">,
    context,
    {
      ...options,
      apiKey: input.apiKey,
      fetch: input.fetch,
      maxTokens: 1_100,
      timeoutMs: 30_000,
      cacheRetention: "none",
    },
  );
  return createPiModelControlledPortfolioAnalyst({ model, streamFn });
}
