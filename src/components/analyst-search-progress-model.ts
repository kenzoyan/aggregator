import type { PortfolioAnalystToolActivity, PortfolioAnalystToolAudit } from "@/application/portfolio-analyst-agent";
import type { PendingPortfolioAnalystTurn } from "@/application/portfolio-analyst-stream";

export function latestToolActivities(activities: readonly PortfolioAnalystToolActivity[]) {
  const calls = new Map<string, PortfolioAnalystToolActivity>();
  for (const activity of activities) calls.set(activity.toolCallId, activity);
  return [...calls.values()];
}

export function currentActivityState(phase: PendingPortfolioAnalystTurn["phase"] | "completed", search: ReturnType<typeof researchProgress>) {
  if (phase === "failed" || phase === "stopped" || phase === "completed") return phase;
  return search.state === "searching" ? "searching" : phase;
}

/** The label is a domain; the link still opens the exact returned source page. */
export function researchWebsites(urls: readonly string[]) {
  const sites = new Map<string, { label: string; url: string }>();
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const label = url.hostname.replace(/^www\./, "");
      if (!sites.has(label)) sites.set(label, { label, url: url.href });
    } catch { /* Invalid source URLs are never rendered as links. */ }
  }
  return [...sites.values()];
}

export function researchProgress(calls: readonly (PortfolioAnalystToolActivity | PortfolioAnalystToolAudit)[], interrupted: boolean) {
  const latest = new Map<string, PortfolioAnalystToolActivity | PortfolioAnalystToolAudit>();
  for (const call of calls) if (call.name === "search_web" || call.name === "discover_price_source") latest.set(call.toolCallId, call);
  const searches = [...latest.values()];
  const sites = researchWebsites(searches.flatMap((call) => "sourceUrls" in call ? call.sourceUrls ?? [] : []));
  const active = searches.some((call) => "stage" in call && call.stage === "started");
  const failed = searches.some((call) => "stage" in call ? call.stage === "failed" : call.status !== "completed") ||
    searches.some((call) => "researchStatus" in call && call.researchStatus === "unavailable");
  const hasResultMetadata = searches.some((call) => "sourceUrls" in call && call.sourceUrls !== undefined);
  return {
    visible: searches.length > 0,
    sites,
    state: interrupted && active ? "interrupted" : active ? "searching" : failed ? "unavailable" : sites.length ? "completed" : hasResultMetadata ? "empty" : "unknown",
  } as const;
}
