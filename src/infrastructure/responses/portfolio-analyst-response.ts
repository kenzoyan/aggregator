import {
  createPortfolioAnalystInput,
  createPortfolioAnalystInstructions,
  portfolioAnalystAnswerCandidateSchema,
  portfolioAnalystAnswerJsonSchema,
  validatePortfolioAnalystAnswer,
} from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-context";
import { PortfolioAnalystProviderError } from "@/application/portfolio-analyst-provider";
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
      instructions: createPortfolioAnalystInstructions(input.context),
      prompt: createPortfolioAnalystInput(input.context),
      schemaName: "portfolio_analyst_answer",
      jsonSchema: portfolioAnalystAnswerJsonSchema,
      parse: (payload) => portfolioAnalystAnswerCandidateSchema.parse(payload),
      fetch: input.fetch,
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
