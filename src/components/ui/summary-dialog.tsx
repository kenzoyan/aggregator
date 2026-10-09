"use client";

import { ArrowUpRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ReviewDialog } from "@/components/ui/review-dialog";

/** Keep the home summary compact while giving its details a full-width reading surface. */
export function SummaryDialog({ title, summary, children }: {
  title: string; summary: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <div className="home-summary-item">
    <button type="button" className="home-summary-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <span>{title}<ArrowUpRight size={14} aria-hidden="true" /></span>
      {summary}
    </button>
    <ReviewDialog open={open} title={title} onClose={() => setOpen(false)}>
      <div className="home-context-detail">{children}</div>
    </ReviewDialog>
  </div>;
}
