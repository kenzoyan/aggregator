"use client";

import { useEffect, useState } from "react";

import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import {
  defaultPortfolioAnalystPreferences,
  readPortfolioAnalystPreferences,
  resolvePortfolioAnalystConversationSettings,
  savePortfolioAnalystPreferences,
  type PortfolioAnalystPreferences,
  type PortfolioAnalystProviderAvailability,
} from "@/application/portfolio-analyst-preferences";
import type { PortfolioAnalystProviderId } from "@/application/portfolio-analyst-provider";

interface AnalystConfiguration {
  defaultProvider: PortfolioAnalystProviderId;
  providers: Array<PortfolioAnalystProviderAvailability & {
    model: string;
  }>;
  conversation?: PortfolioAnalystConversation;
}

const providerNames: Record<PortfolioAnalystProviderId, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

export function PortfolioSettings() {
  const [configuration, setConfiguration] = useState<AnalystConfiguration>();
  const [preferences, setPreferences] = useState<PortfolioAnalystPreferences>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/portfolio/analyst", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Agent configuration could not be loaded.");
        return response.json() as Promise<AnalystConfiguration>;
      })
      .then((value) => {
        setConfiguration(value);
        const restored = readPortfolioAnalystPreferences(
          window.localStorage,
          value.defaultProvider,
        );
        const settings = resolvePortfolioAnalystConversationSettings({
          preferences: restored,
          providers: value.providers,
          fallbackProvider: value.defaultProvider,
        });
        const next = settings.provider !== restored.provider
          ? { ...restored, provider: settings.provider }
          : restored;
        setPreferences(next);
        if (next !== restored) savePortfolioAnalystPreferences(window.localStorage, next);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Agent configuration could not be loaded.");
        setPreferences(defaultPortfolioAnalystPreferences("openai"));
      });
  }, []);

  function updatePreferences(change: Partial<PortfolioAnalystPreferences>) {
    if (!preferences) return;
    const next = { ...preferences, ...change };
    setPreferences(next);
    setSaved(false);
    try {
      savePortfolioAnalystPreferences(window.localStorage, next);
      setSaved(true);
    } catch {
      setError("These preferences could not be saved in this browser.");
    }
  }

  const activeConversation = Boolean(configuration?.conversation?.turns.length);

  return (
    <main className="settings-page">
      <header className="import-header">
        <div>
          <p className="eyebrow">APPLICATION SETTINGS</p>
          <h1>Settings</h1>
          <p>Set defaults for Portfolio Agent and control which portfolio details may be sent to its AI provider.</p>
        </div>
      </header>

      {error && <p className="error-message" role="alert">{error}</p>}
      {!preferences ? (
        <p className="settings-loading">Loading settings…</p>
      ) : (
        <div className="settings-sections">
          <section className="settings-card" aria-labelledby="settings-general-heading">
            <div className="settings-card-heading">
              <div>
                <p className="eyebrow">GENERAL</p>
                <h2 id="settings-general-heading">Agent defaults</h2>
                <p>These values are used when a new conversation starts.</p>
              </div>
              {saved && <span className="settings-saved" role="status">Saved on this device</span>}
            </div>
            <div className="settings-fields">
              <label>
                <span>Default performance period</span>
                <small>Used only when your question does not name a period.</small>
                <select
                  value={preferences.defaultPeriod}
                  onChange={(event) => updatePreferences({
                    defaultPeriod: event.target.value as PortfolioAnalystPreferences["defaultPeriod"],
                  })}
                >
                  <option value="today">Today</option>
                  <option value="week">7 days</option>
                  <option value="month">30 days</option>
                </select>
              </label>
              <label>
                <span>Answer language</span>
                <small>The Agent uses this language for new conversations.</small>
                <select
                  value={preferences.language}
                  onChange={(event) => updatePreferences({
                    language: event.target.value as PortfolioAnalystPreferences["language"],
                  })}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
          </section>

          <section className="settings-card" aria-labelledby="settings-provider-heading">
            <div className="settings-card-heading">
              <div>
                <p className="eyebrow">PORTFOLIO AGENT</p>
                <h2 id="settings-provider-heading">AI provider</h2>
                <p>The selected provider receives the bounded facts needed to answer a question.</p>
              </div>
            </div>
            <div className="settings-provider-grid">
              {(configuration?.providers ?? []).map((item) => (
                <label className={`settings-provider-option${preferences.provider === item.id ? " selected" : ""}`} key={item.id}>
                  <input
                    type="radio"
                    name="agent-provider"
                    value={item.id}
                    checked={preferences.provider === item.id}
                    disabled={!item.configured}
                    onChange={() => updatePreferences({ provider: item.id })}
                  />
                  <span>
                    <strong>{providerNames[item.id]}</strong>
                    <small>{item.configured ? item.model : "API key not configured"}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="settings-card" aria-labelledby="settings-privacy-heading">
            <div className="settings-card-heading">
              <div>
                <p className="eyebrow">AI PRIVACY</p>
                <h2 id="settings-privacy-heading">Holding names</h2>
                <p>Choose whether relevant investment names may accompany portfolio facts sent to the selected AI provider.</p>
              </div>
            </div>
            <label className="settings-privacy-toggle">
              <input
                type="checkbox"
                checked={preferences.includeHoldingNames}
                onChange={(event) => updatePreferences({ includeHoldingNames: event.target.checked })}
              />
              <span>
                <strong>Allow Portfolio Agent to include relevant holding names</strong>
                <small>Each tool includes only names needed for the current question. The number can vary by tool; account IDs, raw imports and internal records are not sent.</small>
              </span>
            </label>
            <div className="settings-privacy-facts">
              <div><strong>When enabled</strong><span>Relevant names can make explanations easier to understand.</span></div>
              <div><strong>When disabled</strong><span>The Agent receives anonymous amounts, percentages and data-quality facts.</span></div>
            </div>
          </section>

          {activeConversation && (
            <aside className="settings-conversation-note">
              <strong>An existing conversation is using its original settings.</strong>
              <p>Your changes apply after you reset that conversation and start a new one.</p>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}
