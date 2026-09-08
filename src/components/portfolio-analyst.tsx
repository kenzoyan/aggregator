"use client";

import { useEffect, useState } from "react";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  AnalystEvidenceFact,
  PortfolioAnalystLanguage,
  PortfolioAnalystRequest,
} from "@/application/portfolio-analyst-context";
import {
  portfolioAnalystActionLabel,
  portfolioAnalystEvidenceValue,
  portfolioAnalystLimitationLabel,
} from "@/application/portfolio-analyst-presentation";
import type {
  PortfolioAnalystProviderId,
  PortfolioAnalystReport,
} from "@/application/portfolio-analyst-provider";
import type { Period } from "@/application/portfolio-read-model";

interface AnalystConfiguration {
  defaultProvider: PortfolioAnalystProviderId;
  providers: Array<{
    id: PortfolioAnalystProviderId;
    configured: boolean;
    model: string;
  }>;
}

const providerNames: Record<PortfolioAnalystProviderId, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

const classificationLabels: Record<
  PortfolioAnalystAnswer["answer"]["classification"],
  string
> = {
  fact: "Fact",
  calculation: "Calculation",
  estimate: "Estimate",
  interpretation: "Interpretation",
};

export function PortfolioAnalyst() {
  const [configuration, setConfiguration] = useState<AnalystConfiguration>();
  const [provider, setProvider] = useState<PortfolioAnalystProviderId>("openai");
  const [job, setJob] = useState<PortfolioAnalystRequest["job"]>("explain-period-drivers");
  const [period, setPeriod] = useState<Period>("week");
  const [language, setLanguage] = useState<PortfolioAnalystLanguage>("zh-CN");
  const [includeHoldingNames, setIncludeHoldingNames] = useState(true);
  const [report, setReport] = useState<PortfolioAnalystReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const selectedProvider = configuration?.providers.find((item) => item.id === provider);

  useEffect(() => {
    let active = true;
    void fetch("/api/portfolio/analyst", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Analyst configuration is unavailable.");
        return response.json() as Promise<AnalystConfiguration>;
      })
      .then((value) => {
        if (!active) return;
        setConfiguration(value);
        const preferred = value.providers.find((item) =>
          item.id === value.defaultProvider && item.configured
        ) ?? value.providers.find((item) => item.configured);
        setProvider(preferred?.id ?? value.defaultProvider);
      })
      .catch(() => {
        if (active) setError("Analyst configuration is unavailable.");
      });
    return () => { active = false; };
  }, []);

  async function runAnalyst() {
    if (!selectedProvider?.configured || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const body: PortfolioAnalystRequest & { provider: PortfolioAnalystProviderId } =
        job === "explain-period-drivers"
          ? { provider, job, period, language, includeHoldingNames }
          : { provider, job, language, includeHoldingNames };
      const response = await fetch("/api/portfolio/analyst", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json() as { result?: PortfolioAnalystReport; error?: string };
      if (!response.ok || !value.result) {
        throw new Error(value.error ?? "The analyst could not complete this job.");
      }
      setReport(value.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The analyst could not complete this job.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="portfolio-analyst" aria-labelledby="portfolio-analyst-title">
      <div className="portfolio-analyst-intro">
        <span className="insight-kicker">ON-DEMAND ANALYST</span>
        <h3 id="portfolio-analyst-title">Ask one bounded question</h3>
        <p>
          The app selects a specific local tool, then sends only its bounded facts to the model.
          Nothing runs until you click Analyze.
        </p>
        <ul>
          <li>No screenshots, credentials, quantities or cost basis</li>
          <li>Portfolio totals and values may be included when relevant</li>
          <li>Suggested data updates are never executed automatically</li>
        </ul>
      </div>

      <div className="portfolio-analyst-workspace">
        <div className="portfolio-analyst-controls">
          <label>
            <span>Job</span>
            <select disabled={loading} value={job} onChange={(event) => {
              setJob(event.target.value as PortfolioAnalystRequest["job"]);
              setReport(undefined);
              setError(undefined);
            }}>
              <option value="explain-period-drivers">Explain performance drivers</option>
              <option value="diagnose-data-quality">Diagnose data quality</option>
            </select>
          </label>
          {job === "explain-period-drivers" && (
            <label>
              <span>Period</span>
              <select disabled={loading} value={period} onChange={(event) => {
                setPeriod(event.target.value as Period);
                setReport(undefined);
                setError(undefined);
              }}>
                <option value="today">Today</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
          )}
          <label>
            <span>Provider</span>
            <select disabled={loading} value={provider} onChange={(event) => {
              setProvider(event.target.value as PortfolioAnalystProviderId);
              setReport(undefined);
              setError(undefined);
            }}>
              {(configuration?.providers ?? [
                { id: "openai" as const, configured: false, model: "" },
                { id: "deepseek" as const, configured: false, model: "" },
              ]).map((item) => (
                <option key={item.id} value={item.id}>
                  {providerNames[item.id]}{item.configured ? "" : " · not configured"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select disabled={loading} value={language} onChange={(event) => {
              setLanguage(event.target.value as PortfolioAnalystLanguage);
              setReport(undefined);
              setError(undefined);
            }}>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="analyst-name-toggle">
            <input
              type="checkbox"
              disabled={loading}
              checked={includeHoldingNames}
              onChange={(event) => {
                setIncludeHoldingNames(event.target.checked);
                setReport(undefined);
                setError(undefined);
              }}
            />
            <span>Allow up to 3 relevant holding names</span>
          </label>
          <button
            type="button"
            onClick={() => void runAnalyst()}
            disabled={!selectedProvider?.configured || loading}
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>

        {!configuration && !error && <p className="portfolio-analyst-state">Checking provider configuration…</p>}
        {selectedProvider && !selectedProvider.configured && !error && (
          <p className="portfolio-analyst-state">
            Add {provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"} to .env.local, then restart the app.
          </p>
        )}
        {error && <p className="portfolio-analyst-error" role="alert">{error}</p>}
        {report && <AnalystReport report={report} />}
      </div>
    </section>
  );
}

function AnalystReport({
  report,
}: {
  report: PortfolioAnalystReport;
}) {
  const language = report.language;
  const evidence = new Map(report.evidence.map((fact) => [fact.key, fact]));
  const answer = report.answer;
  return (
    <article className="portfolio-analyst-result" aria-live="polite">
      <div className="portfolio-analyst-meta">
        <span>{providerNames[report.provider]} · {report.model}</span>
        <span>
          {report.job === "explain-period-drivers"
            ? `Performance drivers · ${report.scope.period ?? "period"}`
            : "Data quality diagnosis"}
        </span>
        <span>Facts as of {new Date(report.factsAsOf).toLocaleString()}</span>
        <span>Generated {new Date(report.generatedAt).toLocaleString()}</span>
      </div>
      <div className="analyst-primary-answer">
        <Classification value={answer.answer.classification} />
        <p>{answer.answer.text}</p>
        <EvidenceKeys keys={answer.answer.evidence} facts={evidence} />
      </div>
      {answer.claims.length > 0 && (
        <ul className="analyst-claims">
          {answer.claims.map((claim, index) => (
            <li key={`${index}:${claim.text}`}>
              <Classification value={claim.classification} />
              <p>{claim.text}</p>
              <EvidenceKeys keys={claim.evidence} facts={evidence} />
            </li>
          ))}
        </ul>
      )}
      {answer.limitations.length > 0 && (
        <div className="analyst-limitations">
          <strong>{language === "zh-CN" ? "已知限制" : "Known limitations"}</strong>
          <ul>
            {answer.limitations.map((limitation) => (
              <li key={limitation.code}>
                {portfolioAnalystLimitationLabel(limitation.code, language)}
                <EvidenceKeys keys={[limitation.evidenceKey]} facts={evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {answer.proposedUpdate && (
        <div className="analyst-proposed-update">
          <span>{language === "zh-CN" ? "建议的事实更新（未执行）" : "Suggested factual update (not executed)"}</span>
          <strong>{portfolioAnalystActionLabel(answer.proposedUpdate, language)}</strong>
          <EvidenceKeys keys={[answer.proposedUpdate.reasonEvidenceKey]} facts={evidence} />
        </div>
      )}
      <details className="portfolio-analyst-evidence">
        <summary>{language === "zh-CN" ? `查看引用的 ${report.evidence.length} 条本地事实` : `View ${report.evidence.length} cited local facts`}</summary>
        <dl>
          {report.evidence.map((fact) => (
            <div key={fact.key} id={`analyst-fact-${fact.key}`}>
              <dt>{fact.label}<small>{fact.key} · {fact.provenance}</small></dt>
              <dd>{portfolioAnalystEvidenceValue(fact, language)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <small className="analyst-disclaimer">{report.disclaimer}</small>
    </article>
  );
}

function Classification({
  value,
}: {
  value: PortfolioAnalystAnswer["answer"]["classification"];
}) {
  return <span className={`analyst-classification ${value}`}>{classificationLabels[value]}</span>;
}

function EvidenceKeys({
  keys,
  facts,
}: {
  keys: string[];
  facts: Map<string, AnalystEvidenceFact>;
}) {
  return (
    <small className="analyst-evidence-keys">
      Based on: {keys.map((key) => facts.get(key)?.label ?? key).join(" · ")}
    </small>
  );
}
