import { normalizeSourceAccountType } from "@/domain/source-accounts";

export function resolveRequestedSourceAccountId(
  accounts: readonly { id: string; accountType: string }[],
  requestedAccountType: string | null,
): string | undefined {
  if (!requestedAccountType) return undefined;
  const normalized = normalizeSourceAccountType(requestedAccountType);
  return accounts.find((account) =>
    normalizeSourceAccountType(account.accountType) === normalized
  )?.id;
}
