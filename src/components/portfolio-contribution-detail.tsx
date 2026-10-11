"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createContributionResearchQuestion } from "@/application/portfolio-contribution-research";
import { sortPeriodContributions, type ContributionSort, type PortfolioPeriodAnalysis } from "@/application/portfolio-period-analysis";
import type { Period } from "@/application/portfolio-read-model";
import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import type { WebResearchSourceFact } from "@/application/portfolio-analyst-contract";
import { analystContributionPeriod } from "@/components/analyst-workspace-selection";
import { ContributionHolding } from "@/components/portfolio-contribution-holding";

const eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;

export function PortfolioContributionDetail({ report, onResearch }: { report: PortfolioAnalystReport; onResearch?: (question: string) => void }) {
  const zh = report.language === "zh-CN";
  const [period, setPeriod] = useState<Period>(() => analystContributionPeriod(report));
  const [sort, setSort] = useState<ContributionSort>("impact");
  const [analysis, setAnalysis] = useState<PortfolioPeriodAnalysis>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const holdingOpener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setAnalysis(undefined); setError(false); setSelectedId(undefined);
    void fetch(`/api/portfolio/analysis?period=${period}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Analysis unavailable");
        const value = await response.json() as { analysis: PortfolioPeriodAnalysis };
        if (!controller.signal.aborted) setAnalysis(value.analysis);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [period, retry]);
  const current = analysis?.period === period ? analysis : undefined;
  const selected = current?.holdings.find((holding) => holding.id === selectedId);
  const periods = { today: zh ? "最近变动" : "Latest moves", week: zh ? "7 天" : "7 days", month: zh ? "30 天" : "30 days" };
  const coverageLabels = { full: zh ? "完整" : "Full", partial: zh ? "部分" : "Partial", unavailable: zh ? "不可计算" : "Unavailable" };
  const sources = report.evidence.filter((fact): fact is WebResearchSourceFact => fact.kind === "web-research-source" &&
    [report.answer.answer.evidence, ...report.answer.claims.map((claim) => claim.evidence)].flat().includes(fact.key));
  return <div className="portfolio-contribution-detail">
    <div className="contribution-periods" role="group" aria-label={zh ? "分析期间" : "Analysis period"}>
      {(["today", "week", "month"] as const).map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{periods[value]}</button>)}
    </div>
    {error ? <div role="alert"><p>{zh ? "暂时无法读取期间数据。" : "Period data could not be loaded."}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>{zh ? "重试" : "Retry"}</button></div>
      : !current ? <p role="status">{zh ? "正在读取本地贡献数据…" : "Loading local contributions…"}</p> : <>
      <p className="contribution-context">{zh ? "最新本地数据，读取于" : "Latest local data, read at"} {new Date(current.factsAsOf).toLocaleString(zh ? "zh-CN" : "en-FI")}. {zh ? "与上方回答快照独立。" : "Separate from the answer snapshot above."}</p>
      <p className="contribution-context">{zh ? "按当前数量回看价格与汇率变化，不包含已退出持仓的实际交易收益；资金转出不算投资亏损。" : "Price and FX changes at current quantities, excluding realized results of exited holdings. Transfers out are not investment losses."}</p>
      <p className="contribution-context">{current.baselineAsOf?.slice(0, 10) ?? "—"} → {current.currentAsOf?.slice(0, 10) ?? "—"} · {zh ? "覆盖" : "Coverage"}: {coverageLabels[current.coverage]}
        {period === "today" && (zh ? " · 各持仓按最近可比较的观测计算，日期可能不同。" : " · Each holding uses its latest comparable observations; dates can differ.")}</p>
      {!current.available && <p role="status">{zh ? "缺少完整可比较的基线，组合涨跌暂不可计算。" : "A complete comparable baseline is missing; portfolio performance is unavailable."}</p>}
      {current.available && <>
        <div className="contribution-total"><span>{zh ? "投资变化" : "Investment change"}</span><strong className={`workspace-fact-value ${current.investmentChangeEur! >= 0 ? "positive" : "negative"}`}>{signed(current.investmentChangeEur!)}</strong><small>{current.percent?.toFixed(2)}%</small></div>
        <div className="workspace-decomposition"><span>{zh ? "价格影响" : "Price effect"}<strong>{current.priceEffectEur === undefined ? "—" : signed(current.priceEffectEur)}</strong></span><span>{zh ? "汇率影响" : "FX effect"}<strong>{current.fxEffectEur === undefined ? "—" : signed(current.fxEffectEur)}</strong></span></div>
        <details className="contribution-reconciliation"><summary>{zh ? "核对贡献与资产变化" : "Reconcile contributions & value changes"}</summary>
          <dl className="contribution-details">
            <div><dt>{zh ? "持仓贡献合计" : "Sum of holding contributions"}</dt><dd>{signed(current.contributionSumEur)}</dd></div>
            <div><dt>{zh ? "与组合变化的差额" : "Residual against portfolio change"}</dt><dd>{signed(current.reconciliationResidualEur!)}</dd></div>
            <div><dt>{zh ? "价格/汇率未拆分差额" : "Price/FX decomposition residual"}</dt><dd>{current.decompositionResidualEur === undefined ? "—" : signed(current.decompositionResidualEur)}</dd></div>
            <div><dt>{zh ? "总资产变化" : "Total value change"}</dt><dd>{current.totalValueChangeEur === undefined ? "—" : signed(current.totalValueChangeEur)}</dd></div>
            {current.totalValueChangeEur !== undefined && <div><dt>{zh ? "资产变化区间" : "Value change window"}</dt><dd>{current.valueBaselineAsOf} → {current.valueCurrentAsOf}</dd></div>}
            <div><dt>{zh ? "估算的其他资产变动" : "Estimated other value movement"}</dt><dd>{current.estimatedActivityEur === undefined ? "—" : signed(current.estimatedActivityEur)}</dd></div>
          </dl>
          <p>{zh ? "其他资产变动是估算差额，并非已核实的净入金；已退出持仓或不同日期口径会限制拆分。" : "Other value movement is an estimate, not verified net deposits. Exited holdings and different date windows limit decomposition."}</p>
        </details>
      </>}
      {selected && <ContributionHolding holding={selected} analysis={current} zh={zh} onBack={() => { setSelectedId(undefined); requestAnimationFrame(() => holdingOpener.current?.focus()); }} />}
      <div hidden={Boolean(selected)}>
        <div className="contribution-list-heading"><h2>{zh ? "持仓贡献" : "Holding contributions"}</h2><label>{zh ? "排序" : "Sort"} <select value={sort} onChange={(event) => setSort(event.target.value as ContributionSort)}>
          <option value="impact">{zh ? "影响最大" : "Largest impact"}</option><option value="gainers">{zh ? "上涨在前" : "Gainers first"}</option><option value="decliners">{zh ? "下跌在前" : "Decliners first"}</option>
        </select></label></div>
        <p className="contribution-context">{zh ? "已覆盖" : "Covered"} {current.holdings.filter((holding) => holding.status === "included").length} / {current.holdings.length}. {zh ? "条形长度比较 EUR 贡献，不使用净涨跌占比。" : "Bars compare EUR contribution, not a share of net performance."}</p>
        {!current.holdings.length && <p>{zh ? "没有保存的持仓。" : "No saved holdings."}</p>}
        <div className="contribution-list">{sortPeriodContributions(current.holdings, sort).map((holding) => {
          const row = holding.contribution;
          const maximum = Math.max(...current.holdings.map((item) => Math.abs(item.contribution?.change ?? 0)), 1);
          return <button type="button" key={holding.id} className="contribution-row" onClick={(event) => { holdingOpener.current = event.currentTarget; setSelectedId(holding.id); }}>
            <span className="contribution-row-title"><strong>{holding.name}</strong><small>{holding.account} · {holding.currency}</small></span>
            {row ? <><span className="contribution-bar" aria-hidden="true"><i className={row.change < 0 ? "loss" : "gain"} style={{ "--contribution-width": `${Math.abs(row.change) / maximum * 50}%` } as CSSProperties} /></span>
              <span className={`contribution-row-value ${row.change >= 0 ? "positive" : "negative"}`}>{signed(row.change)}<small>{row.percent === undefined ? "—" : `${row.percent.toFixed(2)}%`}</small></span></>
              : <span className="contribution-row-status">{holding.status === "excluded-closed" ? (zh ? "已退出 · 不计入" : "Exited · excluded") : holding.status === "missing-valuation" ? (zh ? "缺估值" : "Missing valuation") : holding.status === "period-unavailable" ? (zh ? "区间数据不完整" : "Incomplete period data") : (zh ? "缺基线" : "Missing baseline")}</span>}
          </button>;
        })}</div>
      </div>
      <section className="contribution-research"><h2>{zh ? "为什么涨跌？" : "Why did these holdings move?"}</h2>
        <p>{zh ? "查看这段时间的新闻与市场事件，寻找涨跌的可能原因，并附上来源。" : "Explore news and market events from this period for possible explanations, with sources."}</p>
        <button type="button" disabled={!onResearch || !current.available} onClick={() => onResearch?.(createContributionResearchQuestion(current, report.language, selected))}>{zh ? "分析涨跌原因" : "Explore reasons for gains and losses"}</button>
        <small>{zh ? "点击后问题会填入左侧输入框，你可以修改后发送。已有输入时，请先发送或清空。" : "Adds a question to the chat box. You can edit it before sending. Send or clear any existing input first."}</small>
        {sources.length > 0 && <details><summary>{zh ? "这次回答的外部来源（对应回答快照）" : "External sources from this answer snapshot"}</summary>
          {sources.map((source) => <article key={source.key}><a href={/^https:\/\//i.test(source.url) ? source.url : undefined} target="_blank" rel="noopener noreferrer">{source.title}</a><p>{source.summary}</p><small>{zh ? "检索于" : "Retrieved"} {source.retrievedAt}{source.publishedAt ? ` · ${zh ? "发布" : "Published"} ${source.publishedAt}` : ` · ${zh ? "发布日期未知" : "Publication date unknown"}`}{source.eventAsOf ? ` · ${zh ? "事件日期" : "Event date"} ${source.eventAsOf}` : ""}</small></article>)}
        </details>}
      </section>
    </>}
  </div>;
}
