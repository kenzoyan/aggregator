"use client";

import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";

export function QuietDisclosure({ label, children, defaultOpen = false }: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const reducedMotion = useReducedMotion();
  return <div className="quiet-disclosure">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {label}<ChevronDown size={16} aria-hidden="true" className={open ? "is-open" : undefined} />
    </button>
    <div id={id}>
      <AnimatePresence initial={false}>
        {open && <motion.div className="quiet-disclosure-content"
          initial={{ height: reducedMotion ? "auto" : 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
          exit={{ height: reducedMotion ? "auto" : 0, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .2 }}>
          {children}
        </motion.div>}
      </AnimatePresence>
    </div>
  </div>;
}
