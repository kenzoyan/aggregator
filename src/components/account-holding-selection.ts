import type { SourceAccountHoldingReadModel } from "@/application/source-account-status";

export function selectAccountHolding<T extends Pick<
  SourceAccountHoldingReadModel,
  "id" | "sourceAccountId"
>>(
  holdings: readonly T[],
  accountId: string,
  requestedHoldingId?: string,
): T | undefined {
  const accountHoldings = holdings.filter((holding) => holding.sourceAccountId === accountId);
  return accountHoldings.find((holding) => holding.id === requestedHoldingId) ?? accountHoldings[0];
}
