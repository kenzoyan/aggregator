"use client";

import { useState, type FormEvent } from "react";

import type { SourceAccountView } from "@/application/source-account-status";
import { ReviewDialog } from "@/components/ui/review-dialog";

export function AccountDeletionDialog({ account, busy, error, onClose, onConfirm }: {
  account: SourceAccountView;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (confirmationLabel: string) => Promise<void>;
}) {
  const [confirmationLabel, setConfirmationLabel] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const canConfirm = acknowledged && confirmationLabel === account.label && !busy;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canConfirm) void onConfirm(confirmationLabel);
  }

  return <ReviewDialog open title="Delete account and data" busy={busy} onClose={onClose}>
    <form className="account-delete-dialog operation-dialog-content" onSubmit={submit} aria-busy={busy}>
      <h2>Delete {account.label}?</h2>
      <p>This permanently deletes the account and its local portfolio data:</p>
      <ul>
        <li>Holdings, portfolio cash and holding snapshots</li>
        <li>Import drafts, confirmed imports, sales and cash transfer history</li>
        <li>Saved prices, price sources and synchronization status</li>
      </ul>
      <p>Portfolio totals and history will be recalculated. Saved portfolio analysis will be cleared.</p>
      <p>Saved chat messages, local backups and credentials are kept. This action cannot be undone in the app.</p>
      <fieldset disabled={busy}>
        <label>
          <span>Type <strong>{account.label}</strong> to confirm</span>
          <input required autoComplete="off" spellCheck={false} maxLength={80}
            value={confirmationLabel} onChange={(event) => setConfirmationLabel(event.target.value)} />
        </label>
        <label className="account-delete-acknowledgement">
          <input type="checkbox" required checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>I understand that this account and all its local portfolio data will be permanently deleted.</span>
        </label>
      </fieldset>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="operation-dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="danger" type="submit" disabled={!canConfirm}>
          {busy ? "Deleting…" : "Delete account and data"}
        </button>
      </div>
    </form>
  </ReviewDialog>;
}
