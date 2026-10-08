export const holdingDetailTabs = ["overview", "market"] as const;
export type HoldingDetailTab = typeof holdingDetailTabs[number];

export function holdingTabForKey(current: HoldingDetailTab, key: string): HoldingDetailTab | undefined {
  const index = holdingDetailTabs.indexOf(current);
  if (key === "Home") return holdingDetailTabs[0];
  if (key === "End") return holdingDetailTabs.at(-1);
  if (key === "ArrowRight") return holdingDetailTabs[(index + 1) % holdingDetailTabs.length];
  if (key === "ArrowLeft") return holdingDetailTabs[(index + holdingDetailTabs.length - 1) % holdingDetailTabs.length];
  return undefined;
}
