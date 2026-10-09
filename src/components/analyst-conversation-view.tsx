"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown } from "lucide-react";

export function conversationTurnPlacement(offset: number, contentHeight: number, viewportHeight: number) {
  return {
    spacerHeight: Math.max(0, viewportHeight * 2 / 3 - (contentHeight - offset)),
    scrollTop: Math.max(0, offset - viewportHeight / 3),
  };
}

export function isConversationNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number) {
  return scrollHeight - scrollTop - clientHeight <= 64;
}

/** Give new questions room to breathe, and preserve the reader’s position when loading history. */
export function AnalystConversationView({ children, language, sending }: {
  children: ReactNode;
  language: "en" | "zh-CN";
  sending: boolean;
}) {
  const view = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const mode = useRef<"latest" | "turn" | "reading">("latest");
  const spacer = useRef<HTMLDivElement>(null);
  const alignCurrentTurn = useRef<(() => void) | undefined>(undefined);
  const programmatic = useRef(false);
  const animatingTurn = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const targetScroll = useRef(0);
  const firstEntryOffset = useRef(0);
  const firstEntry = useRef<string | undefined>(undefined);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const viewport = view.current;
    const body = content.current;
    if (!viewport || !body) return;
    const align = (smooth = false) => {
      const bubbles = body.querySelectorAll<HTMLElement>(".analyst-user-entry, .analyst-user-message");
      const anchor = bubbles[bubbles.length - 1];
      if (!anchor || !spacer.current) return;
      const offset = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const placement = conversationTurnPlacement(offset, body.scrollHeight, viewport.clientHeight);
      spacer.current.style.height = `${placement.spacerHeight}px`;
      targetScroll.current = placement.scrollTop;
      if (!smooth && animatingTurn.current) return;
      animatingTurn.current = smooth && !reducedMotion && Math.abs(viewport.scrollTop - targetScroll.current) >= 2;
      programmatic.current = true;
      viewport.scrollTo({ top: targetScroll.current, behavior: smooth && !reducedMotion ? "smooth" : "instant" });
      if (animatingTurn.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          animatingTurn.current = false;
          programmatic.current = false;
          if (mode.current === "turn") align();
        }, 600);
      }
    };
    alignCurrentTurn.current = () => align(true);
    const resize = () => {
      const nextFirst = body.querySelector<HTMLElement>("[data-entry-id]")?.dataset.entryId;
      const prepended = firstEntry.current !== undefined && nextFirst !== firstEntry.current &&
        body.querySelector(`[data-entry-id="${CSS.escape(firstEntry.current)}"]`) !== null;
      if (prepended) {
        const anchor = body.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(firstEntry.current!)}"]`);
        if (anchor) viewport.scrollTop += anchor.getBoundingClientRect().top - body.getBoundingClientRect().top - firstEntryOffset.current;
      } else if (mode.current === "turn") {
        align();
        setAwayFromLatest(body.getBoundingClientRect().bottom > viewport.getBoundingClientRect().bottom + 64);
      } else if (mode.current === "latest") {
        if (spacer.current) spacer.current.style.height = "0px";
        if (!programmatic.current) viewport.scrollTop = viewport.scrollHeight;
      }
      firstEntry.current = nextFirst;
      const anchor = body.querySelector<HTMLElement>("[data-entry-id]");
      firstEntryOffset.current = anchor ? anchor.getBoundingClientRect().top - body.getBoundingClientRect().top : 0;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(body);
    observer.observe(viewport);
    return () => { observer.disconnect(); clearTimeout(settleTimer.current); };
  }, [reducedMotion]);

  useEffect(() => {
    if (sending && view.current) {
      mode.current = "turn";
      setAwayFromLatest(false);
      alignCurrentTurn.current?.();
    }
  }, [sending]);

  return (
    <div className="analyst-conversation-container">
      <div ref={view} className="analyst-conversation" role="log" aria-label={language === "zh-CN" ? "对话记录" : "Conversation"} aria-live="polite" aria-relevant="additions"
        onWheel={() => { mode.current = "reading"; programmatic.current = false; animatingTurn.current = false; }}
        onPointerDown={() => { mode.current = "reading"; programmatic.current = false; animatingTurn.current = false; }}
        onKeyDown={(event) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) { mode.current = "reading"; programmatic.current = false; animatingTurn.current = false; } }}
        onScroll={() => {
        const viewport = view.current;
        if (!viewport) return;
        if (programmatic.current) {
          if (Math.abs(viewport.scrollTop - targetScroll.current) < 2) { programmatic.current = false; animatingTurn.current = false; }
          return;
        }
        if (mode.current === "turn") return;
        const nearBottom = isConversationNearBottom(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight);
        mode.current = nearBottom ? "latest" : "reading";
        setAwayFromLatest(!nearBottom);
      }}>
        <div ref={content} className="analyst-conversation-content">{children}</div>
        <div ref={spacer} aria-hidden="true" className="analyst-turn-space" />
      </div>
      <AnimatePresence>
        {awayFromLatest && <motion.button className="analyst-jump-latest" type="button"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          onClick={() => {
            const viewport = view.current;
            const body = content.current;
            if (viewport && body && body.getBoundingClientRect().bottom > viewport.getBoundingClientRect().bottom + 64) {
              mode.current = "latest";
              if (spacer.current) spacer.current.style.height = "0px";
              clearTimeout(settleTimer.current);
              animatingTurn.current = false;
              targetScroll.current = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
              programmatic.current = true;
              viewport.scrollTo({ top: targetScroll.current, behavior: reducedMotion ? "instant" : "smooth" });
              settleTimer.current = setTimeout(() => {
                programmatic.current = false;
              }, 1200);
            } else {
              mode.current = "turn";
              alignCurrentTurn.current?.();
            }
            setAwayFromLatest(false);
          }}><ArrowDown size={14} aria-hidden="true" />{language === "zh-CN" ? "回到最新" : "Back to latest"}</motion.button>}
      </AnimatePresence>
    </div>
  );
}
