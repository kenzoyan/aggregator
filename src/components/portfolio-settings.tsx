"use client";

import { useEffect, useState } from "react";

import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { PortfolioMemorySettings } from "@/components/portfolio-memory-settings";
import { AIProviderSettings } from "@/components/ai-provider-settings";
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

export function PortfolioSettings() {
  const [configuration, setConfiguration] = useState<AnalystConfiguration>();
  const [preferences, setPreferences] = useState<PortfolioAnalystPreferences>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/portfolio/analyst", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Assistant settings could not be loaded.");
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
        setError(reason instanceof Error ? reason.message : "Assistant settings could not be loaded.");
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
          <p>Set the language and default analysis period for your assistant.</p>
        </div>
      </header>

      {error && <p className="error-message" role="alert">{error}</p>}
      {!preferences ? (
        <p className="settings-loading">Loading settings…</p>
      ) : (
        <div className="settings-sections">
          <PortfolioMemorySettings />
          <section className="settings-card" aria-labelledby="settings-general-heading">
            <div className="settings-card-heading">
              <div>
                <p className="eyebrow">GENERAL</p>
                <h2 id="settings-general-heading">Assistant defaults</h2>
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
                <small>Your assistant uses this language for the next message. Earlier replies stay as written.</small>
                <select
                  value={preferences.language}
                  onChange={(event) => updatePreferences({
                    language: event.target.value as PortfolioAnalystPreferences["language"],
                  })}
                >
                  <option value="en">English</option>
                  <option value="zh-CN">Chinese (Simplified)</option>
                </select>
              </label>
            </div>
          </section>

          <AIProviderSettings />

          {activeConversation && (
            <aside className="settings-conversation-note">
              <strong>Your conversation history stays available.</strong>
              <p>Language changes apply to the next reply.</p>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}
