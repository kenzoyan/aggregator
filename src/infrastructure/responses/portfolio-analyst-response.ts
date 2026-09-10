import {
  createPortfolioAnalystInput,
  createPortfolioAnalystInstructions,
  portfolioAnalystAnswerCandidateSchema,
  portfolioAnalystAnswerJsonSchema,
  projectPartialPortfolioAnalystAnswer,
  validatePortfolioAnalystAnswer,
} from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-context";
import { PortfolioAnalystProviderError } from "@/application/portfolio-analyst-provider";
import type { PortfolioAnalystGenerationTurn } from "@/application/portfolio-analyst-provider";
import {
  requestStructuredResponse,
  StructuredResponseError,
} from "@/infrastructure/responses/structured-response-client";

export async function requestPortfolioAnalystAnswer(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  providerName: string;
  context: PortfolioAnalystContextV1;
  turn?: PortfolioAnalystGenerationTurn;
  store?: false;
  fetch?: typeof globalThis.fetch;
}) {
  let candidate;
  try {
    candidate = await requestStructuredResponse({
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      ...(input.store === false ? { store: false as const } : {}),
      reasoningEffort: "none",
      maxOutputTokens: 1_100,
      timeoutMs: 30_000,
      instructions: createPortfolioAnalystInstructions(input.context, input.turn),
      prompt: createPortfolioAnalystInput(input.context, input.turn),
      schemaName: "portfolio_analyst_answer",
      jsonSchema: portfolioAnalystAnswerJsonSchema,
      parse: (payload) => portfolioAnalystAnswerCandidateSchema.parse(payload),
      fetch: input.fetch,
      signal: input.turn?.signal,
      streamProjection: input.turn?.onAnswerTextDelta
        ? {
            project: projectPartialPortfolioAnalystAnswer,
            onDelta: input.turn.onAnswerTextDelta,
          }
        : undefined,
    });
  } catch (error) {
    throw new PortfolioAnalystProviderError(
      error instanceof StructuredResponseError && error.code === "invalid-response"
        ? "invalid-provider-output"
        : "provider-unavailable",
      input.providerName,
    );
  }

  try {
    return validatePortfolioAnalystAnswer({ context: input.context, candidate });
  } catch {
    throw new PortfolioAnalystProviderError(
      "invalid-provider-output",
      input.providerName,
    );
  }
}
