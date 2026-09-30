import { resolveRequestedSourceAccountId } from "@/components/source-account-selection";

export interface AgentImportAccountOption {
  id: string;
  accountType: string;
  label: string;
  updateMethod: string;
}

export function resolveAgentImportSourceAccount<T extends AgentImportAccountOption>(
  accounts: readonly T[],
  requestedAccountType: string,
): T | undefined {
  const sourceAccountId = resolveRequestedSourceAccountId(accounts, requestedAccountType);
  const account = accounts.find((candidate) => candidate.id === sourceAccountId);
  return account?.updateMethod === "Screenshot" ? account : undefined;
}

export function createAgentImportAnalysisForm(
  sourceAccountId: string,
  screenshots: readonly File[],
): FormData {
  const form = new FormData();
  form.set("sourceAccountId", sourceAccountId);
  form.set("mode", "image");
  screenshots.forEach((file) => form.append("images", file));
  return form;
}
