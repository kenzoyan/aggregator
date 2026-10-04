"use client";

import { useEffect, useState } from "react";

import {
  MAX_PORTFOLIO_ANALYST_MEMORIES,
  MAX_PORTFOLIO_ANALYST_MEMORY_CHARS,
  validMemoryContent,
  type PortfolioAnalystMemory,
} from "@/application/portfolio-analyst-memory";

type PendingAction = { kind: "save" | "delete"; id?: string; content: string };

export function PortfolioMemorySettings() {
  const [memories, setMemories] = useState<PortfolioAnalystMemory[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [pending, setPending] = useState<PendingAction>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/portfolio/analyst/memory", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved memories could not be loaded.");
        return response.json() as Promise<{ memories: PortfolioAnalystMemory[] }>;
      })
      .then((result) => setMemories(result.memories))
      .catch(() => {
        setError("Saved memories could not be loaded.");
        setLoadFailed(true);
      });
  }, []);

  async function confirmAction() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/portfolio/analyst/memory", {
        method: pending.kind === "save" ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending.kind === "save"
          ? { ...(pending.id ? { id: pending.id } : {}), content: pending.content, source: "settings", confirm: true }
          : { id: pending.id, confirm: true }),
      });
      const result = await response.json() as { memory?: PortfolioAnalystMemory; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Memory could not be changed.");
      if (pending.kind === "delete") {
        setMemories((current) => current?.filter((memory) => memory.id !== pending.id));
      } else if (result.memory) {
        setMemories((current) => [result.memory!, ...(current ?? []).filter((memory) => memory.id !== result.memory!.id)]);
      }
      setDraft("");
      setShowEditor(false);
      setEditingId(undefined);
      setPending(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Memory could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="settings-card" aria-labelledby="settings-memory-heading">
    <div className="settings-card-heading"><div>
      <p className="eyebrow">CONFIRMED MEMORY</p>
      <h2 id="settings-memory-heading">Memory</h2>
      <p>Short preferences you confirmed for future conversations. These are separate from assistant defaults and portfolio facts.</p>
    </div></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loadFailed ? null : !memories ? <p>Loading memories…</p> : <>
      {memories.length === 0 ? <p>No memories saved.</p> : <div className="settings-memory-table-wrap"><table className="settings-memory-table">
        <thead><tr><th scope="col">Memory</th><th scope="col">Updated</th><th scope="col" aria-label="Actions" /></tr></thead>
        <tbody>{memories.map((memory) => <tr key={memory.id}>
          <td>{memory.content}</td>
          <td><span>{new Date(memory.updatedAt).toLocaleString()}</span><small>From {memory.source === "chat" ? "chat" : "settings"}</small></td>
          <td><div className="settings-memory-row-actions">
            <button type="button" disabled={busy} onClick={() => {
              setEditingId(memory.id); setDraft(memory.content); setShowEditor(true); setPending(undefined);
            }}>Edit</button>
            <button type="button" disabled={busy} onClick={() => setPending({ kind: "delete", id: memory.id, content: memory.content })}>Delete</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
      {!showEditor && memories.length < MAX_PORTFOLIO_ANALYST_MEMORIES && <button className="settings-memory-add" type="button" onClick={() => {
        setDraft(""); setEditingId(undefined); setPending(undefined); setShowEditor(true);
      }}>Add memory</button>}
      {showEditor && <div className="settings-memory-editor">
        <label htmlFor="memory-draft">{editingId ? "Edit memory" : "Add a memory"}</label>
        <textarea id="memory-draft" value={draft} maxLength={MAX_PORTFOLIO_ANALYST_MEMORY_CHARS}
          onChange={(event) => { setDraft(event.target.value); setPending(undefined); }}
          placeholder="For example: Keep performance explanations brief." />
        <small>Preferences only. Do not enter passwords, keys, screenshots, or financial records. {draft.length}/{MAX_PORTFOLIO_ANALYST_MEMORY_CHARS}</small>
        <div className="settings-memory-actions">
          <button type="button" disabled={busy || !validMemoryContent(draft.trim()) ||
            (editingId ? memories.find((memory) => memory.id === editingId)?.content === draft.trim() : false)}
            onClick={() => setPending({ kind: "save", id: editingId, content: draft.trim() })}>Review {editingId ? "edit" : "save"}</button>
          <button type="button" disabled={busy} onClick={() => {
            setEditingId(undefined); setDraft(""); setPending(undefined); setShowEditor(false);
          }}>Cancel</button>
        </div>
      </div>}
      {pending && <div className="settings-memory-confirm" role="group" aria-label="Confirm memory change">
        <p>{pending.kind === "delete" ? "Delete this memory?" : pending.id ? "Save this edit?" : "Save this new memory?"}</p>
        <blockquote>{pending.content}</blockquote>
        <button type="button" disabled={busy} onClick={() => void confirmAction()}>{busy ? "Working…" : "Confirm"}</button>
        <button type="button" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button>
      </div>}
      <p className="settings-memory-count">{memories.length}/{MAX_PORTFOLIO_ANALYST_MEMORIES} saved memories. All confirmed memories are loaded for ordinary assistant questions.</p>
    </>}
  </section>;
}
