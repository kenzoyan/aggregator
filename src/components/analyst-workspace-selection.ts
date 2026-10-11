import type { AnalystEvidenceFact } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";

export type AnalystWorkspaceAction = "contribution" | "holdings";
export interface AnalystWorkspaceSelection {
  action: AnalystWorkspaceAction;
  report: PortfolioAnalystReport;
}

/** Only offer details supported by this answer, never by unrelated tool results. */
export function analystWorkspaceFacts(report: PortfolioAnalystReport, action: AnalystWorkspaceAction): AnalystEvidenceFact[] {
  const cited = new Set([
    ...report.answer.answer.evidence,
    ...report.answer.claims.flatMap((claim) => claim.evidence),
  ]);
  return report.evidence.filter((fact) => {
    if (!cited.has(fact.key)) return false;
    if (action === "holdings") return fact.kind === "holding-driver" || fact.kind === "account-holding" || fact.kind === "portfolio-mover";
    return fact.kind === "holding-driver" || fact.kind === "period-performance";
  });
}

export function analystWorkspaceActions(report: PortfolioAnalystReport): AnalystWorkspaceAction[] {
  return (["contribution", "holdings"] as const).filter((action) => analystWorkspaceFacts(report, action).length > 0);
}

export function analystWorkspaceActionLabel(action: AnalystWorkspaceAction, language: PortfolioAnalystReport["language"]): string {
  return action === "contribution"
    ? (language === "zh-CN" ? "查看贡献" : "View contribution")
    : (language === "zh-CN" ? "相关持仓" : "Related holdings");
}
