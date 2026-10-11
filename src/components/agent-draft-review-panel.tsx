"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export function AgentDraftReviewPanel({ title, closeLabel, hidden = false, busy = false, onClose, children }: {
  title: string; closeLabel: string; hidden?: boolean; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  return <aside className="agent-draft-review" aria-label={title} hidden={hidden}>
    <div className="review-dialog-toolbar">
      <span>{title}</span>
      <button type="button" aria-label={closeLabel} title={closeLabel} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </div>
    {children}
  </aside>;
}
