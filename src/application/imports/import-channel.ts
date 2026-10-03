import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import type { SourceUpdateMethod } from "@/domain/source-accounts";

export type ImportChannel = "screenshot" | "api";

export function importChannelForUpdateMethod(method: SourceUpdateMethod): ImportChannel {
  return method === "screenshot" ? "screenshot" : "api";
}

export function importChannelForReport(report: PortfolioAnalystReport): ImportChannel | undefined {
  const action = report.answer.proposedUpdate;
  if (action?.kind !== "start-account-import") return undefined;
  const fact = report.evidence.find((item) => item.key === action.reasonEvidenceKey);
  return fact?.kind === "source-account" || fact?.kind === "source-account-import-target"
    ? fact.updateMethod && importChannelForUpdateMethod(fact.updateMethod)
    : undefined;
}
