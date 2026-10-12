"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { currentHoldingsPnl } from "@/application/current-holdings-pnl";
import { holdingsPnlBreakdown, largestPnlContributions, type PnlGrouping } from "@/application/holdings-pnl-breakdown";
import type { PortfolioOverviewReadModel } from "@/application/portfolio-read-model";
import { accountDetailHref } from "@/components/holding-detail-navigation";

const eur = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const signedEur = (value: number) => `${value < 0 ? "−" : "+"}${eur.format(Math.abs(value))}`;

export function HoldingsPnlBreakdown({ portfolio, loading, error, expanded }: {
  portfolio?: PortfolioOverviewReadModel; loading: boolean; error?: string; expanded: boolean;
}) {
  const [grouping, setGrouping] = useState<PnlGrouping>("holding");
  const coverage = portfolio ? currentHoldingsPnl(portfolio) : undefined;
  const entries = largestPnlContributions(holdingsPnlBreakdown(portfolio?.holdings ?? [], grouping));
  const maximum = Math.max(...entries.map((entry) => Math.abs(entry.pnlEur)), 1);
  const available = !loading && !error && Boolean(coverage?.includedHoldingCount);
  return (
    <section id="holdings-pnl-contributions" className="pnl-breakdown" aria-label="Largest holdings profit and loss contributions" aria-busy={loading} hidden={!expanded}>
      <div className="pnl-breakdown-heading">
        <span>Top 5 contributors</span>
        <div className="pnl-grouping" role="group" aria-label="Group profit and loss by">
          {(["holding", "account"] as const).map((option) => <button key={option} type="button" aria-pressed={grouping === option} onClick={() => setGrouping(option)}>{option === "holding" ? "By holding" : "By account"}</button>)}
        </div>
      </div>
      {available ? <>
        {entries.length ? <ul className="pnl-contributions">{entries.map((entry) => (
          <li key={entry.id} className={entry.pnlEur < 0 ? "negative" : "positive"}>
            <Link href={accountDetailHref(entry.sourceAccountId, grouping === "holding" ? entry.id : undefined, "overview")}>
              <span className="pnl-contribution-name">{entry.name}{grouping === "holding" && <small>{entry.account}</small>}</span>
              <span className="pnl-contribution-track" aria-hidden="true"><i style={{ "--pnl-width": `${Math.abs(entry.pnlEur) / maximum * 50}%` } as CSSProperties} /></span>
              <strong className="pnl-contribution-amount">{signedEur(entry.pnlEur)}</strong>
            </Link>
          </li>
        ))}</ul> : <p className="pnl-contribution-empty">No non-zero {grouping === "holding" ? "holding" : "account"} contributions.</p>}
        {coverage?.coverage === "partial" && <p className="pnl-breakdown-note">{coverage.includedHoldingCount}/{coverage.totalHoldingCount} holdings covered.</p>}
      </> : <p className="pnl-contribution-empty" role="status">{loading ? "Loading holdings…" : error ? "Could not load holdings P&L. Use Retry above." : coverage?.coverage === "unavailable" ? "Cost or valuation data unavailable." : "No investment holdings yet."}</p>}
    </section>
  );
}
