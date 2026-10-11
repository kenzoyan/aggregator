import type { PortfolioAnalystLanguage } from "./portfolio-analyst-contract";
import { MAX_PORTFOLIO_ANALYST_QUESTION_CHARS } from "./portfolio-analyst-request-limits";
import { sortPeriodContributions, type PeriodAnalysisHolding, type PortfolioPeriodAnalysis } from "./portfolio-period-analysis";

/** Uses valuation dates rather than the answer's default period or today's headlines. */
export function createContributionResearchQuestion(analysis: PortfolioPeriodAnalysis, language: PortfolioAnalystLanguage, selected?: PeriodAnalysisHolding): string {
  const rows = selected ? [selected] : sortPeriodContributions(analysis.holdings, "impact")
    .filter((holding) => holding.contribution && holding.category !== "Portfolio cash").slice(0, 5);
  const window = `${analysis.baselineAsOf?.slice(0, 10) ?? "?"} → ${analysis.currentAsOf?.slice(0, 10) ?? "?"}`;
  const zh = language === "zh-CN";
  const periods = zh ? { today: "最近变化", week: "7 天", month: "30 天" } : { today: "latest moves", week: "7 days", month: "30 days" };
  const question = zh
    ? `请分析 ${window}（${periods[analysis.period]}）持仓涨跌的可能原因，并附上来源。`
    : `Explain possible reasons for holding gains and losses during ${window} (${periods[analysis.period]}), with sources.`;
  if (!rows.length) return question;
  const prefix = zh ? "重点查看：" : "Focus on: ";
  const labels: string[] = [];
  for (const holding of rows) {
    const dates = `${holding.contribution?.baselineAsOf.slice(0, 10) ?? "?"} → ${holding.contribution?.currentAsOf.slice(0, 10) ?? "?"}`;
    const suffix = dates === window ? "" : ` (${dates})`;
    let name = holding.name;
    const remaining = MAX_PORTFOLIO_ANALYST_QUESTION_CHARS - question.length - 1 - prefix.length - suffix.length;
    // Keep a single selected holding usable even when its display name is unusually long.
    if (!labels.length && name.length > remaining) name = holding.symbol?.slice(0, remaining) || `${name.slice(0, remaining - 1)}…`;
    const label = `${name}${suffix}`;
    if (`${question}\n${prefix}${[...labels, label].join("; ")}`.length > MAX_PORTFOLIO_ANALYST_QUESTION_CHARS) break;
    labels.push(label);
  }
  return `${question}\n${prefix}${labels.join("; ")}`;
}
