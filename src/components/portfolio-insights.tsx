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
          <h2 id="portfolio-insights-title">Portfolio insights</h2>
        </div>
        <span>Calculated locally · facts only</span>
      </header>

      <div className="portfolio-insights-grid">
        <article>
          <span className="insight-kicker">COMPOSITION</span>
          <strong>
            {insights.summary.investmentPositionCount} investments · {" "}
            {insights.summary.sourceAccountCount} accounts
          </strong>
          {insights.summary.topHolding ? (
            <p>
              Largest: <b>{insights.summary.topHolding.name}</b> at {" "}
              {insights.summary.topHolding.sharePercent.toFixed(1)}%.
              Top three represent {insights.summary.topThreeSharePercent.toFixed(1)}%.
            </p>
          ) : (
            <p>No investment positions are currently valued.</p>
          )}
        </article>

        <article>
          <span className="insight-kicker">HOLDING CURRENCY</span>
          <div className="exposure-list">
            {insights.holdingCurrencyAllocation.slice(0, 3).map((exposure) => (
              <div key={exposure.currency}>
                <span>{exposure.currency}</span>
                <strong>{exposure.sharePercent.toFixed(1)}%</strong>
                <i aria-hidden="true">
                  <span style={{ width: `${Math.min(exposure.sharePercent, 100)}%` }} />
                </i>
              </div>
            ))}
          </div>
        </article>

        <article>
          <span className="insight-kicker">LATEST AVAILABLE MOVE</span>
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
            <p>Another dated valuation is needed before a daily move is available.</p>
          )}
        </article>

        <article>
          <span className="insight-kicker">DATA COVERAGE</span>
          <strong className={qualityIssues === 0 ? "positive" : "data-attention"}>
            {qualityIssues === 0 ? "All valued data current" : `${qualityIssues} items need attention`}
          </strong>
          <p>
            {insights.dataQuality.staleCount} stale · {" "}
            {insights.dataQuality.awaitingNavCount} awaiting NAV · {" "}
            {insights.dataQuality.manualCount} manual
          </p>
          {insights.dataQuality.missingInputCount > 0 && (
            <small>{insights.dataQuality.missingInputCount} holdings have missing valuation inputs.</small>
          )}
        </article>
      </div>

    </section>
  );
}
