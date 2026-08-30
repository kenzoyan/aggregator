"use client";

import { useEffect, useState } from "react";

import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";

type ProviderId = "openai" | "deepseek";
type NarrativeLanguage = "en" | "zh-CN";

interface NarrativeConfiguration {
  defaultProvider: ProviderId;
  providers: Array<{
    id: ProviderId;
    configured: boolean;
    model: string;
  }>;
}

interface NarrativeResult {
  provider: ProviderId;
  model: string;
  language: NarrativeLanguage;
  generatedAt: string;
  headline: string;
  overview: string;
  observations: string[];
  dataQuality: string;
  disclaimer: string;
}

const providerNames: Record<ProviderId, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

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
  const [narrativeConfiguration, setNarrativeConfiguration] =
    useState<NarrativeConfiguration>();
  const [providerId, setProviderId] = useState<ProviderId>("openai");
  const [language, setLanguage] = useState<NarrativeLanguage>("en");
  const [narrative, setNarrative] = useState<NarrativeResult>();
  const [narrativeError, setNarrativeError] = useState<string>();
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const today = insights.performance.today;
  const qualityIssues = insights.dataQuality.staleCount +
    insights.dataQuality.awaitingNavCount +
    insights.dataQuality.missingInputCount;
  const movers = insights.recentMovers;
  const oneAvailableMover = movers &&
    movers.strongest.id === movers.weakest.id;
  const selectedProvider = narrativeConfiguration?.providers.find(
    (provider) => provider.id === providerId,
  );

  useEffect(() => {
    let active = true;
    void fetch("/api/portfolio/narrative", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Narrative configuration is unavailable.");
        return response.json() as Promise<NarrativeConfiguration>;
      })
      .then((configuration) => {
        if (!active) return;
        setNarrativeConfiguration(configuration);
        const preferred = configuration.providers.find((provider) =>
          provider.id === configuration.defaultProvider && provider.configured
        ) ?? configuration.providers.find((provider) => provider.configured);
        setProviderId(preferred?.id ?? configuration.defaultProvider);
      })
      .catch(() => {
        if (active) setNarrativeError("Narrative configuration is unavailable.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setNarrative(undefined);
    setNarrativeError(undefined);
  }, [insights.asOf]);

  async function generateNarrative() {
    if (!selectedProvider?.configured || narrativeLoading) return;
    setNarrativeLoading(true);
    setNarrativeError(undefined);
    try {
      const response = await fetch("/api/portfolio/narrative", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: providerId, language, insights }),
      });
      const result = await response.json() as {
        narrative?: NarrativeResult;
        error?: string;
      };
      if (!response.ok || !result.narrative) {
        throw new Error(result.error ?? "The narrative could not be generated.");
      }
      setNarrative(result.narrative);
    } catch (error) {
      setNarrativeError(error instanceof Error
        ? error.message
        : "The narrative could not be generated.");
    } finally {
      setNarrativeLoading(false);
    }
  }

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

      <section className="portfolio-narrative" aria-labelledby="portfolio-narrative-title">
        <div className="portfolio-narrative-intro">
          <span className="insight-kicker">OPTIONAL CLOUD NARRATIVE</span>
          <h3 id="portfolio-narrative-title">Explain these facts</h3>
          <p>
            Generated only when requested. Sends the aggregate insights above,
            not screenshots, credentials, trades, quantities or cost basis.
          </p>
        </div>
        <div className="portfolio-narrative-controls">
          <label>
            <span>Provider</span>
            <select
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value as ProviderId);
                setNarrative(undefined);
                setNarrativeError(undefined);
              }}
            >
              {(narrativeConfiguration?.providers ?? [
                { id: "openai" as const, configured: false, model: "" },
                { id: "deepseek" as const, configured: false, model: "" },
              ]).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {providerNames[provider.id]}{provider.configured ? "" : " · not configured"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value as NarrativeLanguage);
                setNarrative(undefined);
              }}
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void generateNarrative()}
            disabled={!selectedProvider?.configured || narrativeLoading}
          >
            {narrativeLoading ? "Generating…" : "Generate narrative"}
          </button>
        </div>

        {!narrativeConfiguration && !narrativeError && (
          <p className="portfolio-narrative-state">Checking provider configuration…</p>
        )}
        {selectedProvider && !selectedProvider.configured && !narrativeError && (
          <p className="portfolio-narrative-state">
            Add {providerId === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"} to
            .env.local, then restart the app.
          </p>
        )}
        {narrativeError && (
          <p className="portfolio-narrative-error" role="alert">{narrativeError}</p>
        )}
        {narrative && (
          <article className="portfolio-narrative-result">
            <div>
              <span>{providerNames[narrative.provider]} · {narrative.model}</span>
              <time dateTime={narrative.generatedAt}>
                {new Date(narrative.generatedAt).toLocaleString()}
              </time>
            </div>
            <h3>{narrative.headline}</h3>
            <p>{narrative.overview}</p>
            <ul>
              {narrative.observations.map((observation) => (
                <li key={observation}>{observation}</li>
              ))}
            </ul>
            <p><b>Data note:</b> {narrative.dataQuality}</p>
            <small>{narrative.disclaimer}</small>
          </article>
        )}
      </section>
    </section>
  );
}
