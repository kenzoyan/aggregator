"use client";

import { useEffect, useState, type FormEvent } from "react";

interface AISettings {
  provider: "openai";
  model: string;
  hasApiKey: boolean;
  keySource: "settings" | "environment" | "none";
}

export function AIProviderSettings() {
  const [configuration, setConfiguration] = useState<AISettings>();
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/settings/ai-provider", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI settings could not be loaded.");
        const settings = await response.json() as AISettings;
        if (!controller.signal.aborted) { setConfiguration(settings); setModel(settings.model); }
      })
      .catch(() => { if (!controller.signal.aborted) setError("AI settings could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  async function save(removeKey = false) {
    if (!configuration) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/settings/ai-provider", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: removeKey ? configuration.model : model.trim(),
          ...(removeKey ? { apiKey: null } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      if (!response.ok) throw new Error("AI settings could not be saved. Check the model ID and key, then retry.");
      const settings = await response.json() as AISettings;
      setConfiguration(settings); setModel(settings.model); setApiKey("");
      setMessage(removeKey ? "API key removed. AI features are disabled." : "Saved on this device. Applies to the next AI request.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI settings could not be saved.");
    } finally { setSaving(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void save(); }

  return <section className="settings-card" aria-labelledby="settings-provider-heading" aria-busy={loading || saving}>
    <div className="settings-card-heading">
      <div><p className="eyebrow">YOUR ASSISTANT</p><h2 id="settings-provider-heading">AI provider</h2>
        <p>OpenAI · Used for the Agent, screenshots and research.</p></div>
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading ? <p className="settings-loading">Loading AI settings…</p> : !configuration ?
      <button type="button" className="refresh-button" onClick={() => setRetry((value) => value + 1)}>Retry</button> :
      <form onSubmit={submit}>
        <div className="settings-fields">
          <label><span>Model ID</span><small>Enter the OpenAI model you want to use.</small>
            <input required maxLength={128} pattern="[a-zA-Z0-9][a-zA-Z0-9._:\-]*" value={model} disabled={saving}
              onChange={(event) => { setModel(event.target.value); setMessage(""); }} spellCheck={false} autoCapitalize="none" />
          </label>
          <label><span>API key</span><small>{configuration.hasApiKey ? `Key configured${configuration.keySource === "environment" ? " via environment" : ""}. Leave blank to keep it.` : "No API key configured."}</small>
            <input type="password" autoComplete="new-password" maxLength={1024} value={apiKey} disabled={saving}
              placeholder={configuration.hasApiKey ? "Enter a replacement key" : "Enter your OpenAI API key"}
              onChange={(event) => { setApiKey(event.target.value); setMessage(""); }} spellCheck={false} autoCapitalize="none" />
          </label>
        </div>
        <p className="settings-provider-note">Saved locally on this device. Your key is never shown again.</p>
        <div className="settings-provider-actions">
          <button className="primary-button" type="submit" disabled={saving || !model.trim()}>{saving ? "Saving…" : "Save AI settings"}</button>
          {configuration.hasApiKey && <button className="refresh-button" type="button" disabled={saving} onClick={() => void save(true)}>Remove key</button>}
        </div>
        {message && <p className="settings-provider-note" role="status">{message}</p>}
      </form>}
  </section>;
}
