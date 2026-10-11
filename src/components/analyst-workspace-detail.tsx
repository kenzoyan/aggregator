"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { periodLabels } from "@/application/portfolio-period-labels";
import { portfolioAnalystEvidenceValue } from "@/application/portfolio-analyst-presentation";
import { AnalystReport } from "@/components/portfolio-analyst-transcript";
import { analystWorkspaceActionLabel, analystWorkspaceFacts, type AnalystWorkspaceSelection } from "@/components/analyst-workspace-selection";

const eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const signedEur = (value: number) => `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;

/** Read the exact answer snapshot; returning leaves the live overview's state intact. */
export function AnalystWorkspaceDetail({ selection, onBack }: {
  selection: AnalystWorkspaceSelection; onBack: () => void;
}) {
  const { report, action } = selection;
  const zh = report.language === "zh-CN";
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [selection]);
  const facts = analystWorkspaceFacts(report, action);
  return <section className="analyst-workspace-detail" aria-labelledby="workspace-detail-title">
    <button className="workspace-back" type="button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{zh ? "返回概览" : "Back to overview"}</button>
    <header>
      <p className="eyebrow">{zh ? "对话中的数据" : "FROM YOUR CONVERSATION"}</p>
      <h1 id="workspace-detail-title" tabIndex={-1} ref={heading}>{analystWorkspaceActionLabel(action, report.language)}</h1>
      <p>{zh ? "分析快照" : "Analysis snapshot"} · <time dateTime={report.factsAsOf}>{new Date(report.factsAsOf).toLocaleString(zh ? "zh-CN" : "en-FI")}</time></p>
    </header>
    <div className="workspace-facts">
      {facts.map((fact) => <article key={fact.key}>
        {fact.kind === "period-performance" ? <>
          <h2>{periodLabels[fact.period]} · {zh ? "投资变化" : "Investment change"}</h2>
          <strong className={`workspace-fact-value ${fact.changeEur >= 0 ? "positive" : "negative"}`}>{signedEur(fact.changeEur)}</strong>
          <div className="workspace-decomposition">
            <span>{zh ? "价格影响" : "Price effect"}<strong>{signedEur(fact.priceEffectEur)}</strong></span>
            <span>{zh ? "汇率影响" : "FX effect"}<strong>{signedEur(fact.fxEffectEur)}</strong></span>
          </div>
          <small>{fact.baselineAsOf ?? (zh ? "起始日期未提供" : "Baseline date unavailable")} → {fact.currentAsOf ?? (zh ? "结束日期未提供" : "End date unavailable")}{fact.coverage === "partial" ? (zh ? " · 部分期间" : " · Partial range") : ""}</small>
        </> : <>
          <h2>{"name" in fact && fact.name ? fact.name : (zh ? "持仓名称未提供" : "Holding name withheld")}</h2>
          <strong className="workspace-fact-value">{fact.kind === "holding-driver"
            ? signedEur(fact.contributionEur)
            : fact.kind === "account-holding" ? eur.format(fact.valueEur)
              : fact.kind === "portfolio-mover" ? signedEur(fact.changeEur) : ""}</strong>
          <p>{fact.kind === "holding-driver" ? (zh ? "期间贡献" : "Period contribution")
            : fact.kind === "account-holding" ? (zh ? "快照中的持仓价值" : "Holding value at snapshot") : periodLabels.today}</p>
          <details><summary>{zh ? "查看持仓细节" : "Holding details"}</summary><p>{portfolioAnalystEvidenceValue(fact, report.language)}</p></details>
        </>}
      </article>)}
    </div>
    <details className="workspace-answer-evidence"><summary>{zh ? "回答依据与数据来源" : "Answer evidence & data sources"}</summary><AnalystReport report={report} sourcesOnly /></details>
  </section>;
}
