"use client";

import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  MarketIntelligenceBrief,
  MarketIntelligenceSource,
} from "@/application/market-intelligence";

interface MarketIntelligencePayload {
  configured: boolean;
  model: string;
  latestBrief?: MarketIntelligenceBrief;
}

const categoryLabels = {
  "central-bank": "Central bank",
  inflation: "Inflation",
  employment: "Employment",
  growth: "Growth",
  other: "Macro",
} as const;

function formatDate(date: string, language: MarketIntelligenceBrief["language"]) {
  return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-FI", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat("en-FI", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatHelsinkiTime(
  value: string,
  language: MarketIntelligenceBrief["language"],
) {
  return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-FI", {
    timeZone: "Europe/Helsinki",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function uniqueOrganizationSources(
  sources: readonly MarketIntelligenceSource[],
) {
  const organizations = new Set<string>();
  return sources.filter((source) => {
    const organization = new URL(source.url).hostname.replace(/^www\./, "");
    if (organizations.has(organization)) return false;
    organizations.add(organization);
    return true;
  });
}

function sourceLabel(source: MarketIntelligenceSource) {
  const hostname = new URL(source.url).hostname.replace(/^www\./, "");
  if (hostname.endsWith("federalreserve.gov")) return "Federal Reserve";
  if (hostname.endsWith("ecb.europa.eu")) return "ECB";
  if (hostname.endsWith("eurostat.ec.europa.eu")) return "Eurostat";
  if (hostname.endsWith("ec.europa.eu")) return "European Commission";
  if (hostname.endsWith("bls.gov")) return "U.S. BLS";
  if (hostname.endsWith("bea.gov")) return "U.S. BEA";
  return source.title;
}

export function MarketIntelligence() {
  const [configuration, setConfiguration] = useState<MarketIntelligencePayload>();
  const [brief, setBrief] = useState<MarketIntelligenceBrief>();
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/market-intelligence", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Market watch could not be loaded.");
        return response.json() as Promise<MarketIntelligencePayload>;
      })
      .then((payload) => {
        setConfiguration(payload);
        setBrief(payload.latestBrief);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Market watch could not be loaded.");
        }
      });
    return () => controller.abort();
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError(undefined);
    try {
      const response = await fetch("/api/market-intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "en" }),
      });
      const payload = await response.json() as { brief?: MarketIntelligenceBrief; error?: string };
      if (!response.ok || !payload.brief) {
        throw new Error(payload.error ?? "Official market calendars could not be refreshed.");
      }
      setBrief(payload.brief);
      setExpanded(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Official market calendars could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="market-intelligence" aria-labelledby="market-intelligence-title">
      <header className="market-intelligence-heading">
        <div>
          <p className="eyebrow">EXTERNAL MARKET WATCH</p>
          <h2 id="market-intelligence-title">Upcoming market events</h2>
          <p>Official macro calendar · next 30 days · refreshed on demand</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || configuration?.configured === false}
        >
          <RefreshCw aria-hidden="true" className={refreshing ? "is-spinning" : undefined} />
          {refreshing ? "Checking official calendars…" : brief ? "Refresh events" : "Check upcoming events"}
        </button>
      </header>

      {error && <p className="market-intelligence-error" role="alert">{error}</p>}
      {configuration?.configured === false && (
        <p className="market-intelligence-empty">Add OPENAI_API_KEY to use official-source web search.</p>
      )}
      {!brief && configuration?.configured === true && !error && (
        <div className="market-intelligence-empty">
          <CalendarDays aria-hidden="true" />
          <span>No external brief yet. Run a check when you want a fresh 30-day calendar.</span>
        </div>
      )}
      {brief && (
        <>
          <div className="market-intelligence-meta">
            <span>{brief.windowStart} — {brief.windowEnd}</span>
            <span>Checked {formatCheckedAt(brief.generatedAt)}</span>
          </div>
          {brief.events.length === 0 ? (
            <p className="market-intelligence-empty">No confirmed high-impact events were found in this window.</p>
          ) : (
            <div className="market-intelligence-events" id="market-intelligence-events">
              {(expanded ? brief.events : brief.events.slice(0, 1)).map((event, eventIndex) => (
                <article key={`${event.date}:${event.category}:${event.title}:${eventIndex}`}>
                  <div className="market-event-date">
                    <strong>{formatDate(event.date, brief.language)}</strong>
                    <small>{event.time ?? (brief.language === "zh-CN" ? "未注明具体时间" : "Time not specified")}</small>
                    {event.scheduledAt && (
                      <small className="market-event-europe-time">
                        {brief.language === "zh-CN" ? "赫尔辛基" : "Helsinki"} · {formatHelsinkiTime(event.scheduledAt, brief.language)}
                      </small>
                    )}
                    <div className="market-event-sources" aria-label="Official sources">
                      {uniqueOrganizationSources(event.sources).map((source, sourceIndex) => (
                        <a key={`${source.url}:${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer">
                          {sourceLabel(source)}<ExternalLink aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  </div>
                  <div className="market-event-body">
                    <span className="market-event-label">{event.region} · {categoryLabels[event.category]}</span>
                    <h3>{event.title}</h3>
                    <p>{event.summary}</p>
                    <div className="market-event-impact">
                      <span>{brief.language === "zh-CN" ? "为何重要" : "Why it matters"}</span>
                      <p>{event.whyItMatters}</p>
                    </div>
                  </div>
                </article>
              ))}
              {brief.events.length > 1 && (
                <button
                  type="button"
                  className="market-intelligence-expand"
                  aria-expanded={expanded}
                  aria-controls="market-intelligence-events"
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  {expanded ? "Show less" : `+${brief.events.length - 1} more events`}
                </button>
              )}
            </div>
          )}
          <p className="market-intelligence-disclaimer">{brief.disclaimer}</p>
        </>
      )}
    </section>
  );
}
