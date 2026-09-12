import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";

const eur = new Intl.NumberFormat("en-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function signedEur(value: number): string {
  return `${value >= 0 ? "+" : "−"}${eur.format(Math.abs(value))}`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
}

export function PortfolioInsights({
  insights,
}: {
  insights: PortfolioInsightsReadModel;
}) {
  const today = insights.performance.today;
  const qualityIssues = insights.dataQuality.staleCount +
    insights.dataQuality.awaitingNavCount +
    insights.dataQuality.missingInputCount;
  const movers = insights.recentMovers;
  const oneAvailableMover = movers &&
    movers.strongest.id === movers.weakest.id;
  return (
    <section className="portfolio-insights" aria-labelledby="portfolio-insights-title">
      <header className="portfolio-insights-heading">
        <div>
          <p className="eyebrow">PORTFOLIO INTELLIGENCE</p>
          <h2 id="portfolio-insights-title">What matters now</h2>
        </div>
        <span>Calculated locally</span>
      </header>

      <div className="portfolio-insights-grid">
        <article className="portfolio-change-insight">
          <span className="insight-kicker">WHAT CHANGED</span>
          {today.available ? (
            <>
              <strong className={today.changeEur >= 0 ? "positive" : "negative"}>
                {signedEur(today.changeEur)} · {signedPercent(today.percent)}
              </strong>
              <p>
                Price {signedEur(today.priceChangeEur)} · FX {signedEur(today.fxChangeEur)}
              </p>
              {movers && (
                <small>
                  {oneAvailableMover
                    ? `Available holding: ${movers.strongest.name}`
                    : `Strongest contribution: ${movers.strongest.name} · Weakest: ${movers.weakest.name}`}
                </small>
              )}
            </>
          ) : (
            <><strong>No comparable daily move yet</strong><p>Another dated valuation is needed before a daily change is available.</p></>
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
  );
}
