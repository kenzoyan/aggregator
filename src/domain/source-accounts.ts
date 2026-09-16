export type SourceProvider = "alipay" | "wechat" | "danske" | "trading212" | "generic";
export type SourceUpdateMethod = "screenshot" | "trading-212";

export interface SourceAccountDefinition {
  id: string;
  accountType: string;
  normalizedAccountType: string;
  provider: SourceProvider;
  label: string;
  dashboardLabel: string;
  updateMethod: SourceUpdateMethod;
}

export interface CreateSourceAccountDefinitionInput {
  id: string;
  accountType: string;
  label?: string;
}

const knownAccountTypes: Record<
  string,
  Pick<SourceAccountDefinition, "id" | "provider" | "updateMethod">
> = {
  alipay: { id: "alipay-main", provider: "alipay", updateMethod: "screenshot" },
  wechat: { id: "wechat-main", provider: "wechat", updateMethod: "screenshot" },
  wechatwealthmanagement: {
    id: "wechat-main",
    provider: "wechat",
    updateMethod: "screenshot",
  },
  danskebank: { id: "danske-main", provider: "danske", updateMethod: "screenshot" },
  danske: { id: "danske-main", provider: "danske", updateMethod: "screenshot" },
  trading212: {
    id: "trading212-main",
    provider: "trading212",
    updateMethod: "trading-212",
  },
};

export function normalizeSourceAccountType(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function sourceAccountIdForType(accountType: string, fallbackId: string): string {
  return knownAccountTypes[normalizeSourceAccountType(accountType)]?.id ?? fallbackId;
}

export function createSourceAccountDefinition(
  input: CreateSourceAccountDefinitionInput,
): SourceAccountDefinition {
  const accountType = input.accountType.trim().replace(/\s+/g, " ");
  const normalizedAccountType = normalizeSourceAccountType(accountType);
  if (!normalizedAccountType) throw new Error("Source Account type cannot be empty");
  const label = input.label?.trim() || accountType;
  const knownAccount = knownAccountTypes[normalizedAccountType];
  const capability = knownAccount ? {
    provider: knownAccount.provider,
    updateMethod: knownAccount.updateMethod,
  } : {
    provider: "generic" as const,
    updateMethod: "screenshot" as const,
  };
  return {
    id: input.id,
    accountType,
    normalizedAccountType,
    ...capability,
    label,
    dashboardLabel: label,
  };
}

export const sourceAccounts: readonly SourceAccountDefinition[] = [
  createSourceAccountDefinition({ id: "alipay-main", accountType: "Alipay" }),
  {
    ...createSourceAccountDefinition({
      id: "wechat-main",
      accountType: "WeChat Wealth Management",
    }),
    dashboardLabel: "WeChat",
  },
  {
    ...createSourceAccountDefinition({ id: "danske-main", accountType: "Danske Bank" }),
    dashboardLabel: "Danske",
  },
  createSourceAccountDefinition({ id: "trading212-main", accountType: "Trading 212" }),
];

export const trading212SourceAccountId = "trading212-main";

export class SourceAccountDeletionError extends Error {
  constructor(readonly code: "has-data" | "not-found") {
    super({
      "has-data": "Source Account has portfolio data",
      "not-found": "Source Account was not found",
    }[code]);
    this.name = "SourceAccountDeletionError";
  }
}

export function findSourceAccount(id: string): SourceAccountDefinition | undefined {
  return sourceAccounts.find((account) => account.id === id);
}

export function sourceAccountDashboardLabel(
  id: string,
  labels: Readonly<Record<string, string>> = {},
): string {
  return labels[id] ?? findSourceAccount(id)?.dashboardLabel ?? id;
}

export function effectiveSourceAccountLabels(
  accounts: readonly SourceAccountDefinition[],
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return Object.fromEntries(accounts.map((account) => [
    account.id,
    overrides[account.id] ?? account.dashboardLabel,
  ]));
}
