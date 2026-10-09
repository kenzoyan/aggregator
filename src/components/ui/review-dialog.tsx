"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** A dismissible review surface. Closing it does not discard its mounted draft. */
export function ReviewDialog({ open, title, busy = false, onClose, children }: {
  open: boolean; title: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.current?.showModal();
      close.current?.focus();
    } else if (!open && dialog.current?.open) {
      dialog.current.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
    const element = dialog.current;
    return () => {
      if (element?.open) {
        element.close();
        if (opener.current?.isConnected) opener.current.focus();
        else document.querySelector<HTMLTextAreaElement>(".analyst-composer textarea")?.focus();
      }
    };
  }, [open]);
  return <dialog ref={dialog} className="review-dialog" aria-label={title}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || busy) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className="review-dialog-toolbar"><span>{title}</span><button ref={close} type="button" disabled={busy} aria-label="Close review" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <div className="review-dialog-body">{children}</div>
  </dialog>;
}
