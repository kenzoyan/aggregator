export type SourceProvider = "alipay" | "wechat" | "danske" | "trading212";
export type SourceUpdateMethod = "screenshot" | "trading-212";

export interface SourceAccountDefinition {
  id: string;
  provider: SourceProvider;
  label: string;
  dashboardLabel: string;
  updateMethod: SourceUpdateMethod;
}

export const sourceAccounts: readonly SourceAccountDefinition[] = [
  { id: "alipay-main", provider: "alipay", label: "Alipay", dashboardLabel: "Alipay", updateMethod: "screenshot" },
  { id: "wechat-main", provider: "wechat", label: "WeChat Wealth Management", dashboardLabel: "WeChat", updateMethod: "screenshot" },
  { id: "danske-main", provider: "danske", label: "Danske Bank", dashboardLabel: "Danske", updateMethod: "screenshot" },
  { id: "trading212-main", provider: "trading212", label: "Trading 212", dashboardLabel: "Trading 212", updateMethod: "trading-212" },
];

export const trading212SourceAccountId = "trading212-main";

export function findSourceAccount(id: string): SourceAccountDefinition | undefined {
  return sourceAccounts.find((account) => account.id === id);
}

export function sourceAccountDashboardLabel(
  id: string,
  labels: Readonly<Record<string, string>> = {},
): string {
  return labels[id] ?? findSourceAccount(id)?.dashboardLabel ?? id;
}
