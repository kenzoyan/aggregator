import { SummaryDialog } from "@/components/ui/summary-dialog";
import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";

const eur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function signedEur(value: number): string {
  return `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;
}

export function PortfolioInsights({
  insights,
}: {
  insights: PortfolioInsightsReadModel;
}) {
  const today = insights.performance.today;
  const coverage = insights.latestDailyCoverage;
  const qualityIssues = insights.dataQuality.staleCount +
    insights.dataQuality.awaitingNavCount +
    insights.dataQuality.missingInputCount;
  const movers = insights.recentMovers;
  const oneAvailableMover = movers &&
    movers.strongest.id === movers.weakest.id;
  function comparisonDates(holdingId: string) {
    const comparison = coverage?.comparisons.find((item) => item.holdingId === holdingId);
    return comparison?.baselineAsOf && comparison.currentAsOf
      ? `${comparison.baselineAsOf.slice(0, 10)} → ${comparison.currentAsOf.slice(0, 10)}`
      : "Comparison dates unavailable";
  }
  return (
    <SummaryDialog title="Change sources & data" summary={<><strong className={qualityIssues ? "data-attention" : undefined}>{qualityIssues ? `${qualityIssues} items need attention` : "No current data issues"}</strong><small>{today.available ? "View latest daily contributions and coverage" : "Not enough data to explain daily changes yet"}</small></>}>
      <section className="portfolio-insights">
      <header className="portfolio-insights-heading">
        <div>
          <p className="eyebrow">PORTFOLIO INTELLIGENCE</p>
          <h2 id="portfolio-insights-title">Change sources &amp; data status</h2>
        </div>
        <span>Calculated locally</span>
      </header>

      <div className="portfolio-insights-grid">
        <article className="portfolio-change-insight">
          <span className="insight-kicker">LATEST DAILY CHANGE SOURCES</span>
          {today.available ? (
            <>
              <p className="insight-scope-note">Latest comparable daily price and FX moves per holding. Dates may differ. This is not today's full portfolio value movement; purchases, sales and cash transfers are excluded.</p>
              {coverage?.componentsAvailable
                ? <div className="insight-contribution-row"><span>Price contribution <strong>{signedEur(today.priceChangeEur)}</strong></span><span>FX contribution <strong>{signedEur(today.fxChangeEur)}</strong></span></div>
                : <p>Price and FX contributions are not fully available.</p>}
              <p>{coverage ? `${coverage.includedCount} of ${coverage.totalCount} investment holdings have comparable daily data.` : "Daily data coverage unavailable."}</p>
              {movers && (
                <div className="insight-mover-list">
                  <div><small>{oneAvailableMover ? "Available holding" : "Highest contribution"}</small><p>{movers.strongest.name} <strong>{signedEur(movers.strongest.changeEur)}</strong></p><small>{comparisonDates(movers.strongest.id)}</small></div>
                  {!oneAvailableMover && <div><small>Lowest contribution</small><p>{movers.weakest.name} <strong>{signedEur(movers.weakest.changeEur)}</strong></p><small>{comparisonDates(movers.weakest.id)}</small></div>}
                </div>
              )}
              {coverage && <div className="insight-date-coverage"><span className="insight-kicker">COMPARISON DATES</span><ul>{coverage.comparisons.map((item) => <li key={item.holdingId}><span>{item.name}</span><small>{comparisonDates(item.holdingId)}</small></li>)}</ul></div>}
            </>
          ) : (
            <><strong>Not enough data to explain daily changes yet</strong><p>Another dated valuation is needed. No change or contribution is assumed.</p></>
          )}
        </article>

        <article className="portfolio-attention-insight">
          <span className="insight-kicker">NEEDS ATTENTION</span>
          <strong className={qualityIssues === 0 ? "positive" : "data-attention"}>
            {qualityIssues === 0 ? "No current data issues" : `${qualityIssues} items need attention`}
          </strong>
          <p>
            {insights.dataQuality.freshCount} current · {insights.dataQuality.staleCount} stale · {" "}
            {insights.dataQuality.awaitingNavCount} awaiting NAV
          </p>
          {insights.dataQuality.manualCount > 0 && (
            <small>{insights.dataQuality.manualCount} holdings use manually entered market values.</small>
          )}
          {insights.dataQuality.missingInputCount > 0 && (
            <small>{insights.dataQuality.missingInputCount} holdings have missing valuation inputs.</small>
          )}
        </article>
      </div>

      <div className="portfolio-shape-summary">
        <span>Portfolio shape</span>
        <strong>{insights.summary.investmentPositionCount} investments · {insights.summary.sourceAccountCount} accounts</strong>
        {insights.summary.topHolding && (
          <small>Largest: {insights.summary.topHolding.name} at {insights.summary.topHolding.sharePercent.toFixed(1)}% · Top three {insights.summary.topThreeSharePercent.toFixed(1)}%</small>
        )}
      </div>

      </section>
    </SummaryDialog>
  );
}
