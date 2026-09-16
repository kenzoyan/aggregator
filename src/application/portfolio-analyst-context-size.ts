import {
  ANALYST_CONTEXT_MAX_BYTES,
  PortfolioAnalystContextError,
  type PortfolioAnalystContextV1,
} from "@/application/portfolio-analyst-contract";

export function assertPortfolioAnalystContextSize(
  context: PortfolioAnalystContextV1,
): void {
  const serializedBytes = new TextEncoder().encode(JSON.stringify(context));
  if (serializedBytes.byteLength > ANALYST_CONTEXT_MAX_BYTES) {
    throw new PortfolioAnalystContextError("context-too-large");
  }
}
