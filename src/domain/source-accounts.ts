export const sourceAccounts = [
  { id: "alipay-main", label: "Alipay", dashboardLabel: "Alipay" },
  { id: "wechat-main", label: "WeChat Wealth Management", dashboardLabel: "WeChat" },
  { id: "danske-main", label: "Danske Bank", dashboardLabel: "Danske" },
  { id: "trading212-main", label: "Trading 212", dashboardLabel: "Trading 212" },
] as const;

export const trading212SourceAccountId = "trading212-main";

export function sourceAccountDashboardLabel(id: string): string {
  return sourceAccounts.find((account) => account.id === id)?.dashboardLabel ?? id;
}
