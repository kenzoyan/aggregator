export const holdingDetailTabs = ["overview", "market"] as const;
export type HoldingDetailTab = typeof holdingDetailTabs[number];

type AccountEntry = string | string[] | undefined;

export function accountDetailHref(accountId: string, holdingId?: string, from?: AccountEntry): string {
  const params = new URLSearchParams();
  if (holdingId) params.set("holding", holdingId);
  if (from === "holdings" || from === "overview") params.set("from", from);
  const query = params.toString();
  return `/accounts/${encodeURIComponent(accountId)}${query ? `?${query}` : ""}`;
}

export function accountDetailBackLink(from?: AccountEntry) {
  if (from === "holdings") return { href: "/#holdings", label: "← Overview" };
  if (from === "overview") return { href: "/#overview", label: "← Overview" };
  return { href: "/accounts", label: "← All accounts" };
}

export function holdingTabForKey(current: HoldingDetailTab, key: string): HoldingDetailTab | undefined {
  const index = holdingDetailTabs.indexOf(current);
  if (key === "Home") return holdingDetailTabs[0];
  if (key === "End") return holdingDetailTabs.at(-1);
  if (key === "ArrowRight") return holdingDetailTabs[(index + 1) % holdingDetailTabs.length];
  if (key === "ArrowLeft") return holdingDetailTabs[(index + holdingDetailTabs.length - 1) % holdingDetailTabs.length];
  return undefined;
}
