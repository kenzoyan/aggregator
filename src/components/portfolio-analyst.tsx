"use client";

import { motion } from "motion/react";
import { Expand, Shrink, MoreHorizontal, Send, Square } from "lucide-react";
import { AnalystConversationView } from "@/components/analyst-conversation-view";
import { AssistantMessageContent } from "@/components/assistant-message-content";
import Image from "next/image";
import { ReviewDialog } from "@/components/ui/review-dialog";
import { useEffect, useRef, useState } from "react";

import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type {
  FactualUpdate,
  PortfolioAnalystLanguage,
} from "@/application/portfolio-analyst-contract";
import {
  readPortfolioAnalystPreferences,
  resolvePortfolioAnalystConversationSettings,
  type PortfolioAnalystProviderAvailability,
} from "@/application/portfolio-analyst-preferences";
import type {
  PortfolioAnalystProviderId,
} from "@/application/portfolio-analyst-provider";
import type { Period } from "@/application/portfolio-read-model";
import {
  createImportDraftConfirmationPayload,
  type ImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import {
  nextImportDateFollowUp,
} from "@/application/imports/import-chat-follow-up";
import {
  applyImportDraftEdit,
  type ImportDraftEdit,
} from "@/application/imports/import-review-editor";
import {
  createAgentComposerSubmission,
  readTextOnlyAgentQuestion,
} from "@/components/agent-composer-submission";
import {
  createAgentImageAttachmentState,
  lockAgentImageAttachments,
  resetAgentImageAttachments,
  unlockAgentImageAttachments,
  type AgentImageAttachmentState,
} from "@/components/agent-image-attachment-state";
import { AgentImageAttachments } from "@/components/agent-image-attachments";
import {
  AgentActivityTimeline,
  AnalystReport,
  PendingAgentMessageImages,
  SavedConversationEntries,
  pendingPhaseLabel,
} from "@/components/portfolio-analyst-transcript";
import { AgentSaleDraftReview } from "@/components/agent-sale-draft-review";
import { AgentImportDraftReview } from "@/components/agent-import-draft-review";
import {
  applyPortfolioAnalystStreamEvent,
  beginPendingPortfolioAnalystTurn,
  consumePortfolioAnalystStream,
  portfolioAnalystStreamContentType,
  type PendingPortfolioAnalystTurn,
} from "@/application/portfolio-analyst-stream";

export { AgentActivityTimeline, AnalystReport, analystLimitationKey } from "@/components/portfolio-analyst-transcript";

interface AnalystConfiguration {
  defaultProvider: PortfolioAnalystProviderId;
  providers: Array<PortfolioAnalystProviderAvailability & {
    model: string;
  }>;
  conversation?: PortfolioAnalystConversation;
  importDrafts?: ImportDraftReadModel[];
}

const starterQuestions = {
  "zh-CN": [
    "帮我总结目前的整体资产状况，包括所有账户、各项持仓和资产分布。",
    "今天我的投资组合表现怎么样？",
    "最近 7 天哪些持仓对组合影响最大？",
    "当前资产数据有哪些需要更新？",
    "帮我创建一个新的投资账户。",
  ],
  en: [
    "Summarize my current assets across all accounts, including every holding and the overall allocation.",
    "How is my portfolio performing today?",
    "Which holdings affected my portfolio most over the last 7 days?",
    "Which portfolio data needs updating?",
    "Help me create a new investment account.",
  ],
} as const;

export function PortfolioAnalyst({
  blocked = false,
  onPortfolioChanged,
}: {
  blocked?: boolean;
  onPortfolioChanged?: () => void;
}) {
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const [focusedChat, setFocusedChat] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deleteCancel = useRef<HTMLButtonElement>(null);
  const conversationOptions = useRef<HTMLElement>(null);
  const conversationMenu = useRef<HTMLDetailsElement>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const [configuration, setConfiguration] = useState<AnalystConfiguration>();
  const [provider, setProvider] = useState<PortfolioAnalystProviderId>("openai");
  const [period, setPeriod] = useState<Period>("week");
  const [language, setLanguage] = useState<PortfolioAnalystLanguage>("en");
  const [reviewPanel, setReviewPanel] = useState<"sale" | "memory" | "sources" | "import">();
  const [selectedReviewId, setSelectedReviewId] = useState<string>();
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const includeHoldingNames = true;
  const [conversation, setConversation] = useState<PortfolioAnalystConversation>();
  const [pendingTurnImageId, setPendingTurnImageId] = useState<string>();
  const [pendingTurn, setPendingTurn] = useState<PendingPortfolioAnalystTurn>();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [memoryReviewBusy, setMemoryReviewBusy] = useState(false);
  const [memoryReviewError, setMemoryReviewError] = useState("");
  const [importAttachments, setImportAttachments] = useState<AgentImageAttachmentState<File>>(
    () => createAgentImageAttachmentState<File>(),
  );
  const [pendingImageMessage, setPendingImageMessage] = useState<{ text: string; files: readonly File[] }>();
  const [importDrafts, setImportDrafts] = useState<Record<string, ImportDraftReadModel>>({});
  const importDraftsRef = useRef<Record<string, ImportDraftReadModel>>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef<Record<string, number>>({});
  const saveErrors = useRef<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [accountActionStatus, setAccountActionStatus] = useState<Record<
    string,
    "confirming" | "created" | "failed"
  >>({});
  const selectedProvider = configuration?.providers.find((item) => item.id === provider);
  const activeSaleTurn = conversation?.turns.findLast((turn) => turn.chat?.saleDraft?.status === "pending");

  useEffect(() => {
    let active = true;
    void fetch("/api/portfolio/analyst", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Analyst configuration is unavailable.");
        return response.json() as Promise<AnalystConfiguration>;
      })
      .then((value) => {
        if (!active) return;
        setConfiguration(value);
        const restored = value.conversation;
        const preferences = readPortfolioAnalystPreferences(
          window.localStorage,
          value.defaultProvider,
        );
        const settings = resolvePortfolioAnalystConversationSettings({
          preferences,
          providers: value.providers,
          fallbackProvider: value.defaultProvider,
          conversation: restored,
        });
        const latestReport = restored?.turns.at(-1)?.report;
        setConversation(restored);
        const drafts = Object.fromEntries((value.importDrafts ?? []).map((draft) => [draft.id, draft]));
        importDraftsRef.current = drafts;
        setImportDrafts(drafts);
        setProvider(settings.provider);
        setLanguage(settings.language);
        if (!restored) setPeriod(preferences.defaultPeriod);
        if (latestReport) {
          if (latestReport.job === "explain-period-drivers" && latestReport.scope.period) {
            setPeriod(latestReport.scope.period);
          }
        }
      })
      .catch(() => {
        if (active) setError("Analyst configuration is unavailable.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const input = composer.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(Math.max(input.scrollHeight, 72), 180)}px`;
    }
  }, [question]);

  useEffect(() => {
    if (deleteDialogOpen) {
      deleteDialog.current?.showModal();
      deleteCancel.current?.focus();
    } else deleteDialog.current?.close();
  }, [deleteDialogOpen]);

  useEffect(() => {
    const menu = conversationMenu.current;
    if (!menu) return;
    function closeOutside(event: Event) {
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu?.open) {
        menu.open = false;
        conversationOptions.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => () => { activeRequest.current?.abort(); }, []);

  function submitComposer() {
    const submission = createAgentComposerSubmission({
      text: question,
      screenshots: importAttachments.files,
    });
    if (!submission) return;
    if (submission.screenshots.length > 0) {
      void sendImageMessage(submission);
      return;
    }
    void runAnalyst(submission.text);
  }

  async function resolveMemoryProposal(action: "save" | "cancel", turnId: string) {
    if (!conversation || memoryReviewBusy) return;
    setMemoryReviewBusy(true);
    setMemoryReviewError("");
    try {
      const response = await fetch("/api/portfolio/analyst/memory", {
        method: action === "save" ? "PUT" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "save"
          ? { conversationId: conversation.id, turnId, confirm: true }
          : { conversationId: conversation.id, turnId, action: "cancel" }),
      });
      const result = await response.json() as { conversation?: PortfolioAnalystConversation; error?: string };
      if (!response.ok || !result.conversation) throw new Error(result.error ?? "Memory review could not be completed.");
      setConversation(result.conversation);
    } catch (cause) {
      setMemoryReviewError(cause instanceof Error ? cause.message : "Memory review could not be completed.");
    } finally {
      setMemoryReviewBusy(false);
    }
  }

  async function sendImageMessage(
    submission: NonNullable<ReturnType<typeof createAgentComposerSubmission<File>>>,
  ) {
    if (loading || importBusy) return;
    setImportBusy(true);
    setError(undefined);
    setPendingImageMessage({ text: submission.text, files: submission.screenshots });
    setImportAttachments((current) => lockAgentImageAttachments(current));
    const controller = new AbortController();
    activeRequest.current = controller;
    let saved: PortfolioAnalystConversation | undefined;
    let turnId: string | undefined;
    try {
      const form = new FormData();
      form.set("userText", submission.text);
      form.set("language", language);
      form.set("provider", provider);
      form.set("includeHoldingNames", String(includeHoldingNames));
      if (conversation) form.set("conversationId", conversation.id);
      submission.screenshots.forEach((file) => form.append("images", file));
      const response = await fetch("/api/portfolio/analyst/images/message", {
        method: "POST", body: form, signal: controller.signal,
      });
      const payload = await response.json() as {
        conversation?: PortfolioAnalystConversation; turnId?: string; error?: string;
      };
      if (!response.ok || !payload.conversation || !payload.turnId) {
        throw new Error(payload.error ?? "The image message could not be sent.");
      }
      saved = payload.conversation;
      turnId = payload.turnId;
      setConversation(saved);
      setPendingImageMessage(undefined);
      setQuestion("");
      setImportAttachments((current) => resetAgentImageAttachments(current));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The image message could not be sent.");
      }
    } finally {
      activeRequest.current = undefined;
      setPendingImageMessage(undefined);
      setImportAttachments((current) => unlockAgentImageAttachments(current));
      setImportBusy(false);
    }
    if (saved && turnId) void runAnalyst(submission.text || (language === "zh-CN" ? "请解释这些图片。" : "Explain these images."), { conversation: saved, imageSourceTurnId: turnId });
  }

  async function retryWorkflowReply(turnId: string) {
    if (!conversation || loading || importBusy) return;
    setImportBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/portfolio/analyst/workflow/reply", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, turnId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.conversation) throw new Error("Agent reply could not be retried.");
      setConversation(payload.conversation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent reply could not be retried."); }
    finally { setImportBusy(false); }
  }


  function retryFailedTurn() {
    if (!pendingTurn || loading || importBusy) return;
    const text = pendingTurn.question;
    setPendingTurn(undefined); setError(undefined);
    void runAnalyst(text, conversation && pendingTurnImageId ? { conversation, imageSourceTurnId: pendingTurnImageId } : undefined);
  }

  function queueDraftSave(draft: ImportDraftReadModel): Promise<void> {
    const revision = (saveRevision.current[draft.id] ?? 0) + 1;
    saveRevision.current[draft.id] = revision;
    saveErrors.current[draft.id] = false;
    setSaveStatus((current) => ({ ...current, [draft.id]: "saving" }));
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/imports/${draft.id}/review`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createImportDraftConfirmationPayload(draft)),
      });
      if (!response.ok) throw new Error("Draft save failed.");
      if (saveRevision.current[draft.id] === revision) {
        setSaveStatus((current) => ({ ...current, [draft.id]: "saved" }));
      }
    }).catch(() => {
      if (saveRevision.current[draft.id] === revision) {
        saveErrors.current[draft.id] = true;
        setSaveStatus((current) => ({ ...current, [draft.id]: "error" }));
      }
    });
    return saveQueue.current;
  }

  function editImportDraft(draftId: string, edit: ImportDraftEdit): Promise<void> {
    const current = importDraftsRef.current[draftId];
    if (!current) return Promise.resolve();
    const next = applyImportDraftEdit(current, edit);
    importDraftsRef.current = { ...importDraftsRef.current, [draftId]: next };
    setImportDrafts(importDraftsRef.current);
    return queueDraftSave(next);
  }

  function addImportHolding(draftId: string) {
    const draft = importDraftsRef.current[draftId];
    const currency = draft?.portfolio.holdings[0]?.currency ||
      draft?.portfolio.portfolioCash?.currency || "EUR";
    editImportDraft(draftId, {
      type: "add-holding",
      holding: {
        lineId: crypto.randomUUID(),
        instrumentId: "",
        displayName: "",
        quantity: "1",
        currency,
        costBasis: "",
        reportedPriorReturn: "0",
      },
    });
  }

  async function confirmAccountImport(draftId: string) {
    const importDraft = importDraftsRef.current[draftId];
    if (!importDraft || importDraft.status !== "draft" || loading || importBusy) return;
    if (importDraft.portfolio.holdings.length === 0 && !importDraft.portfolio.portfolioCash) {
      setError("Add at least one holding before confirmation.");
      return;
    }
    setImportBusy(true);
    setError(undefined);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      await saveQueue.current;
      if (saveErrors.current[draftId]) throw new Error("Draft save failed. Please edit and retry.");
      const response = await fetch(`/api/imports/${importDraft.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createImportDraftConfirmationPayload(importDraft)),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        draft?: ImportDraftReadModel;
        conversation?: PortfolioAnalystConversation;
        error?: string;
        reconciliation?: ImportDraftReadModel["reconciliation"];
      };
      if (payload.conversation) setConversation(payload.conversation);
      if (!response.ok || !payload.draft) {
        if (payload.reconciliation) {
          importDraftsRef.current = { ...importDraftsRef.current, [draftId]: { ...importDraft, reconciliation: payload.reconciliation } };
          setImportDrafts(importDraftsRef.current);
        }
        throw new Error(payload.error ?? "Confirmation failed.");
      }
      importDraftsRef.current = { ...importDraftsRef.current, [draftId]: payload.draft };
      setImportDrafts(importDraftsRef.current);
      setImportAttachments((current) => resetAgentImageAttachments(current));
      setReviewPanel(undefined);
      onPortfolioChanged?.();
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "Confirmation failed.");
      }
    } finally {
      activeRequest.current = undefined;
      setImportBusy(false);
    }
  }

  async function runAnalyst(requestedQuestion?: string, context?: { conversation: PortfolioAnalystConversation; imageSourceTurnId: string }) {
    const submission = createAgentComposerSubmission({
      text: requestedQuestion ?? question,
      screenshots: [],
    });
    const normalizedQuestion = readTextOnlyAgentQuestion(submission);
    if (!selectedProvider?.configured || loading || !normalizedQuestion) return;
    setLoading(true);
    setError(undefined);
    setPendingTurnImageId(context?.imageSourceTurnId);
    setPendingTurn(beginPendingPortfolioAnalystTurn(normalizedQuestion));
    setQuestion("");
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      await saveQueue.current;
      if (activeReview && saveErrors.current[activeReview.draftId]) throw new Error("Please fix the draft save error before continuing.");
      const body: {
        mode: "agent";
        provider: PortfolioAnalystProviderId;
        defaultPeriod: Period;
        language: PortfolioAnalystLanguage;
        includeHoldingNames: boolean;
        question: string;
        imageSourceTurnId?: string;
        importDraftId?: string;
        conversationId?: string;
      } = {
        mode: "agent",
        provider,
        defaultPeriod: period,
        language,
        includeHoldingNames,
        question: normalizedQuestion,
        ...((context?.conversation ?? conversation) ? { conversationId: (context?.conversation ?? conversation)!.id } : {}),
        ...(context ? { imageSourceTurnId: context.imageSourceTurnId } : {}),
        ...(activeReview ? { importDraftId: activeReview.draftId } : {}),
      };
      const response = await fetch("/api/portfolio/analyst", {
        method: "POST",
        headers: {
          accept: portfolioAnalystStreamContentType,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("The analyst stream could not be opened.");
      let streamFinished = false;
      let completedConversation: PortfolioAnalystConversation | undefined;
      await consumePortfolioAnalystStream(response, (event) => {
        if (event.type === "completed") {
          streamFinished = true;
          completedConversation = event.conversation;
          setConversation(event.conversation);
          if (event.importDrafts) {
            importDraftsRef.current = Object.fromEntries(event.importDrafts.map((draft) => [draft.id, draft]));
            setImportDrafts(importDraftsRef.current);
            const newDraft = event.importDrafts.find((draft) => draft.status === "draft" && !conversation?.importActivities.some((a) => a.draftId === draft.id));
            if (newDraft) { setSelectedReviewId(newDraft.id); setReviewPanel("import"); }
          }
          if (event.conversation.turns.at(-1)?.chat?.memoryProposal) {
            setSelectedEvidenceId(undefined);
            setMemoryReviewError("");
            setReviewPanel("memory");
          }
          setPendingTurn(undefined);
          return;
        }
        // The structured answer is checked after generation. Showing its draft text here
        // makes a provisional sentence appear to be a saved chat message before it is replaced.
        if (event.type === "answer-delta") return;
        if (event.type === "failed") {
          streamFinished = true;
        }
        setPendingTurn((current) => current
          ? applyPortfolioAnalystStreamEvent(current, event)
          : current);
      });
      if (!streamFinished) {
        throw new Error("The analyst stream ended before the answer was complete.");
      }
      return completedConversation;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setPendingTurn((current) => current
          ? { ...current, answerText: "", phase: "stopped" }
          : current);
      } else {
        setPendingTurn((current) => current
          ? { ...current, answerText: "", phase: "failed", failureCode: "connection-failed" }
          : current);
      }
    } finally {
      activeRequest.current = undefined;
      setLoading(false);
    }
  }

  async function resetConversation() {
    if (loading || importBusy) return;
    setError(undefined);
    try {
      if (conversation) {
        const response = await fetch("/api/portfolio/analyst", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: conversation.id }),
        });
        if (!response.ok) {
          setError("The local conversation could not be deleted.");
          return;
        }
      }
      setConversation(undefined);
      setSelectedEvidenceId(undefined);
      setSelectedReviewId(undefined);
      setPendingTurn(undefined);
      setQuestion("");
      setImportAttachments((current) => resetAgentImageAttachments(current));
      importDraftsRef.current = {};
      setImportDrafts({});
      const fallbackProvider = configuration?.defaultProvider ?? "openai";
      const preferences = readPortfolioAnalystPreferences(
        window.localStorage,
        fallbackProvider,
      );
      const settings = resolvePortfolioAnalystConversationSettings({
        preferences,
        providers: configuration?.providers ?? [],
        fallbackProvider,
      });
      setProvider(settings.provider);
      setLanguage(settings.language);
      setPeriod(preferences.defaultPeriod);
    } catch {
      if (conversation) {
        setError("The local conversation could not be deleted.");
      }
    }
  }

  async function confirmCreateAccount(
    actionKey: string,
    action: Extract<FactualUpdate, { kind: "create-account" }>,
  ) {
    setAccountActionStatus((current) => ({ ...current, [actionKey]: "confirming" }));
    setError(undefined);
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountType: action.accountType, label: action.label }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Account could not be created.");
      setAccountActionStatus((current) => ({ ...current, [actionKey]: "created" }));
    } catch (cause) {
      setAccountActionStatus((current) => ({ ...current, [actionKey]: "failed" }));
      setError(cause instanceof Error ? cause.message : "Account could not be created.");
    }
  }

  const reviewActivities = conversation?.importActivities.filter((activity) =>
    importDrafts[activity.draftId]?.status === "draft"
  ) ?? [];
  const activeReview = reviewActivities.find((activity) => activity.draftId === selectedReviewId)
    ?? reviewActivities.at(-1);
  const activeDraft = activeReview && importDrafts[activeReview.draftId];
  const activeDateRequest = activeDraft && nextImportDateFollowUp(activeDraft);
  const selectedEvidenceTurn = conversation?.turns.find((turn) => turn.id === selectedEvidenceId && turn.report);
  const pendingMemoryTurn = conversation?.turns.findLast((turn) => turn.chat?.memoryProposal?.status === "pending");

  return (
    <div
      className={`portfolio-agent-shell${focusedChat ? " agent-focused" : ""}`}
      id="agent"
      aria-hidden={blocked || undefined}
      inert={blocked || undefined}
    >
      <aside
        id="portfolio-analyst-panel"
        className="portfolio-analyst"
        aria-labelledby="portfolio-analyst-title"
      >
        <header className="portfolio-agent-header">
          <div className="portfolio-agent-identity">
            <Image src="/brand/aggrigator-icon-192.png" alt="" width={42} height={42} />
            <div>
              <h2 id="portfolio-analyst-title">Aggrigator</h2>
              <p>{language === "zh-CN" ? "随时接着聊，也可以分享截图。" : "Pick up anytime. Questions or screenshots welcome."}</p>
            </div>
          </div>
          <div className="agent-header-actions">
            <button type="button" aria-pressed={focusedChat} aria-label={language === "zh-CN" ? "专注聊天" : "Focus chat"} title={language === "zh-CN" ? "专注聊天" : "Focus chat"} onClick={() => setFocusedChat(!focusedChat)}>
              {focusedChat ? <Shrink size={17} /> : <Expand size={17} />}
            </button>
            <details ref={conversationMenu} className="agent-manage-menu">
              <summary ref={conversationOptions} aria-label={language === "zh-CN" ? "对话管理" : "Conversation options"}><MoreHorizontal size={18} aria-hidden="true" /></summary>
              <div><button type="button" disabled={!conversation || loading || importBusy} onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                setDeleteDialogOpen(true);
              }}>{language === "zh-CN" ? "删除聊天记录…" : "Delete chat history…"}</button></div>
            </details>
          </div>
        </header>

        <div className="portfolio-analyst-workspace">
        {!configuration && !error && <p className="portfolio-analyst-state">Checking provider configuration…</p>}
        {selectedProvider && !selectedProvider.configured && !error && (
          <p className="portfolio-analyst-state">
            Add OPENAI_API_KEY to .env.local, then restart the app.
          </p>
        )}
        <AnalystConversationView language={language} sending={Boolean(pendingTurn?.phase === "sending" || pendingImageMessage)}>
          {!conversation?.turns.length && !conversation?.importActivities.length && !pendingTurn && (
            <div className="analyst-conversation-empty">
              <h3>{language === "zh-CN" ? "今天想了解什么？" : "What’s on your mind?"}</h3>
              <p>{language === "zh-CN" ? "一起看看你的资产，或从一个问题开始。" : "Let’s look at your portfolio, or start with a question."}</p>
              <div className="analyst-starter-grid">
                {starterQuestions[language].map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    disabled={loading || !selectedProvider?.configured}
                    onClick={() => void runAnalyst(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {conversation && <SavedConversationEntries key={conversation.id}
            conversation={conversation}
            importDrafts={importDrafts}
            onRetryTurn={(turnId) => {
              const turn = conversation.turns.find((item) => item.id === turnId);
              if (turn) void runAnalyst(turn.userText || turn.question || (language === "zh-CN" ? "解释这张图片。" : "Explain this image."));
            }}
            onRetryWorkflowReply={(turnId) => void retryWorkflowReply(turnId)}
            activeReviewDraftId={activeReview?.draftId}
            activeDateRequest={activeDateRequest}
            language={language}
            accountActionStatus={accountActionStatus}
            selectedEvidenceId={reviewPanel === "sources" ? selectedEvidenceId : undefined}
            loading={loading}
            importBusy={importBusy}
            onConfirmCreateAccount={(turnId, action) => void confirmCreateAccount(turnId, action)}
            onShowSources={(turnId) => {
              setSelectedEvidenceId(turnId);
              setReviewPanel("sources");
            }}
            onReviewDraft={(draftId) => {
              setSelectedEvidenceId(undefined);
              setSelectedReviewId(draftId);
              setReviewPanel("import");
            }}
          />}
          {pendingImageMessage && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-current-turn="true" className="analyst-turn pending" aria-live="polite">
              <div className="analyst-user-entry">
                <PendingAgentMessageImages files={pendingImageMessage.files} />
                {pendingImageMessage.text && <div className="analyst-user-message"><p>{pendingImageMessage.text}</p></div>}
                <AgentActivityTimeline activities={[]} language={language} phase="sending" statusHistory={[]} />
              </div>
            </motion.div>
          )}
          {importBusy && !pendingImageMessage && !loading && <AgentActivityTimeline
            activities={[]} language={language} phase="generating-answer" statusHistory={[]} />}
          {pendingTurn && !pendingImageMessage && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-current-turn="true" className="analyst-turn pending">
              {!pendingTurnImageId && <div className="analyst-user-message">
                <p>{pendingTurn.question}</p>
              </div>}
              <AgentActivityTimeline
                activities={pendingTurn.activities}
                language={language}
                phase={pendingTurn.phase}
                statusHistory={pendingTurn.statusHistory}
              />
              {pendingTurn.answerText ? (
                <div className={`analyst-streaming-message analyst-assistant-message ${pendingTurn.phase}`}>
                    <AssistantMessageContent text={pendingTurn.answerText} />
                    <span className="analyst-stream-indicator" aria-hidden="true" />
                    <small>{language === "zh-CN" ? "正在整理回答…" : "Putting your answer together…"}</small>
                </div>
              ) : pendingTurn.phase === "failed" || pendingTurn.phase === "stopped" ? (
                <div className={`analyst-streaming-message analyst-assistant-message ${pendingTurn.phase}`}>
                  <p>{pendingPhaseLabel(pendingTurn.phase, language, pendingTurn.failureCode)}</p>
                  {pendingTurn.phase === "failed" && <button type="button" className="secondary"
                    onClick={retryFailedTurn} disabled={loading || importBusy}>
                    {language === "zh-CN" ? "重试" : "Try again"}
                  </button>}
                </div>
              ) : null}
            </motion.div>
          )}
          {error && <div className="analyst-turn" role="alert">
            <div className="analyst-primary-answer analyst-assistant-message"><p>{error}</p></div>
          </div>}
        </AnalystConversationView>
        <div className="agent-review-launchers">
          {activeSaleTurn && <button type="button" onClick={() => setReviewPanel("sale")}>{language === "zh-CN" ? "核对卖出草稿" : "Review sale draft"}</button>}
          {activeReview && <button type="button" onClick={() => setReviewPanel("import")}>{language === "zh-CN" ? "核对导入草稿" : "Review import draft"}</button>}
          {pendingMemoryTurn && <button type="button" onClick={() => setReviewPanel("memory")}>{language === "zh-CN" ? "确认记忆" : "Review memory"}</button>}
        </div>
        <div className="analyst-composer">
          <div className="analyst-composer-box">
            <textarea
              ref={composer}
              rows={2}
              maxLength={600}
              disabled={loading || importBusy || !selectedProvider?.configured}
              value={question}
              aria-label={language === "zh-CN" ? "给助手发送消息" : "Message your assistant"}
              placeholder={language === "zh-CN" ? "提出问题，或分享一张图片……" : "Ask a question or share an image…"}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitComposer();
                }
              }}
            />
            <div className="analyst-composer-bottom">
              <AgentImageAttachments
                state={importAttachments}
                language={language}
                onChange={setImportAttachments}
              />
              <div className="analyst-composer-actions">
                {loading || importBusy ? (
                  <motion.button whileTap={{ scale: .96 }} type="button" className="secondary" disabled={Boolean(pendingImageMessage)} onClick={() => activeRequest.current?.abort()}
                    aria-label={pendingImageMessage
                      ? (language === "zh-CN" ? "发送中…" : "Sending…")
                      : (language === "zh-CN" ? "停止" : "Stop")}
                    title={pendingImageMessage
                      ? (language === "zh-CN" ? "发送中…" : "Sending…")
                      : (language === "zh-CN" ? "停止" : "Stop")}>
                    <Square size={15} aria-hidden="true" />
                  </motion.button>
                ) : (
                  <motion.button whileTap={{ scale: .96 }} type="button" onClick={submitComposer}
                    aria-label={language === "zh-CN" ? "发送" : "Send"}
                    title={language === "zh-CN" ? "发送" : "Send"}
                    disabled={!selectedProvider?.configured || (!question.trim() && importAttachments.files.length === 0)}>
                    <Send size={18} aria-hidden="true" />
                  </motion.button>
                )}
              </div>
            </div>
          </div>
          <div className="analyst-composer-meta">
            <small>{language === "zh-CN" ? "仅供信息，不构成投资建议" : "Information only, not investment advice"}</small>
          </div>
        </div>
        </div>
      </aside>
      <dialog ref={deleteDialog} className="agent-delete-dialog" aria-labelledby="agent-delete-title" onCancel={() => setDeleteDialogOpen(false)} onClose={() => { setDeleteDialogOpen(false); conversationOptions.current?.focus(); }}>
        <h2 id="agent-delete-title">{language === "zh-CN" ? "删除聊天记录？" : "Delete chat history?"}</h2>
        <p>{language === "zh-CN" ? "这会删除当前聊天记录及关联图片。已确认的资产记录和长期记忆会保留。此操作无法撤销。" : "This deletes this chat and its attached images. Confirmed portfolio records and saved memories remain. This cannot be undone."}</p>
        <div className="agent-delete-actions">
          <button ref={deleteCancel} type="button" onClick={() => setDeleteDialogOpen(false)}>{language === "zh-CN" ? "保留记录" : "Keep history"}</button>
          <button type="button" className="destructive" disabled={loading || importBusy} onClick={() => {
            setDeleteDialogOpen(false);
            void resetConversation();
          }}>{language === "zh-CN" ? "删除记录" : "Delete history"}</button>
        </div>
      </dialog>
      {conversation && activeSaleTurn?.chat?.saleDraft && (
        <ReviewDialog open={reviewPanel === "sale"} title={language === "zh-CN" ? "核对卖出" : "Review sale"} busy={importBusy || memoryReviewBusy || Object.values(saveStatus).includes("saving")} onClose={() => setReviewPanel(undefined)}>

        <AgentSaleDraftReview key={activeSaleTurn.id} conversationId={conversation.id} turnId={activeSaleTurn.id}
          draft={activeSaleTurn.chat.saleDraft} language={language} onConversation={setConversation}
          disabled={loading || importBusy} onBusy={setImportBusy} onSaved={() => { setReviewPanel(undefined); onPortfolioChanged?.(); }} />
        </ReviewDialog>
      )}
      {pendingMemoryTurn?.chat?.memoryProposal && (
        <ReviewDialog open={reviewPanel === "memory"} title={language === "zh-CN" ? "确认记忆" : "Review memory"} busy={importBusy || memoryReviewBusy || Object.values(saveStatus).includes("saving")} onClose={() => setReviewPanel(undefined)}>

        <section className="home-review-panel home-memory-review" aria-label="Review memory">
          <div className="home-review-panel-heading">
            <div><p className="eyebrow">MEMORY REVIEW</p><h2>{language === "zh-CN" ? "确认这条记忆" : "Confirm this memory"}</h2></div>
          </div>
          <p>{language === "zh-CN" ? "确认后，这条偏好会用于以后的一般提问。它不会更改持仓数据。" : "After confirmation, this preference can guide future answers. It will not change portfolio facts."}</p>
          <blockquote>{pendingMemoryTurn.chat.memoryProposal.content}</blockquote>
          {memoryReviewError && <p role="alert" className="error-message">{memoryReviewError}</p>}
          <div className="home-memory-review-actions">
            <button type="button" disabled={memoryReviewBusy} onClick={() => void resolveMemoryProposal("save", pendingMemoryTurn.id)}>{memoryReviewBusy ? (language === "zh-CN" ? "正在保存…" : "Saving…") : language === "zh-CN" ? "确认保存" : "Save memory"}</button>
            <button type="button" disabled={memoryReviewBusy} onClick={() => void resolveMemoryProposal("cancel", pendingMemoryTurn.id)}>{language === "zh-CN" ? "不保存" : "Do not save"}</button>
          </div>
        </section>
        </ReviewDialog>
      )}
      {selectedEvidenceTurn?.report && (
        <ReviewDialog open={reviewPanel === "sources"} title={language === "zh-CN" ? "事实与来源" : "Facts and sources"} onClose={() => setReviewPanel(undefined)}>

        <section id="agent-sources-panel" className="home-review-panel home-sources-panel" aria-label="Sources for the selected answer" tabIndex={-1}>
          <div className="home-review-panel-heading">
            <div>
              <p className="eyebrow">ANSWER SOURCES</p>
              <h2>Facts and sources</h2>
              <p className="home-sources-question">{selectedEvidenceTurn.userText ?? selectedEvidenceTurn.question}</p>
            </div>
            <button type="button" className="home-review-close" onClick={() => {
              const sourceButton = document.getElementById(`sources-${selectedEvidenceTurn.id}`);
              setReviewPanel(undefined);
              window.requestAnimationFrame(() => sourceButton?.focus());
            }} aria-label="Close sources">×</button>
          </div>
          <div className="home-review-scroll">
            <AnalystReport report={selectedEvidenceTurn.report} sourcesOnly />
          </div>
        </section>
        </ReviewDialog>
      )}
      {activeReview && activeDraft && (
        <ReviewDialog open={reviewPanel === "import"} title={language === "zh-CN" ? "核对导入" : "Review import"} busy={importBusy || memoryReviewBusy || Object.values(saveStatus).includes("saving")} onClose={() => setReviewPanel(undefined)}>

        <section className="home-review-panel" aria-label={`Review ${activeReview.targetLabel} import`}>
          <div className="home-review-panel-heading">
            <div><p className="eyebrow">IMPORT REVIEW</p><h2>Review {activeReview.targetLabel}</h2></div>
            <span>Changes apply after confirmation</span>
          </div>
          <div className="home-review-scroll">
            {error && <p role="alert" className="error-message">{error}</p>}
            <AgentImportDraftReview
              draft={activeDraft}
              targetLabel={activeReview.targetLabel}
              language={language}
              busy={loading || importBusy}
              saveStatus={saveStatus[activeReview.draftId]}
              onEdit={(edit) => editImportDraft(activeReview.draftId, edit)}
              onAddHolding={() => addImportHolding(activeReview.draftId)}
              onConfirm={() => void confirmAccountImport(activeReview.draftId)}
            />
          </div>
        </section>
        </ReviewDialog>
      )}
    </div>
  );
}
