"use client";

import { AgentPriceSourceReviewContent } from "@/components/agent-price-source-review";
import { createPortal } from "react-dom";
import { MAX_PORTFOLIO_ANALYST_QUESTION_CHARS } from "@/application/portfolio-analyst-request-limits";
import { motion } from "motion/react";
import { Expand, Shrink, MoreHorizontal, Send, Square, X } from "lucide-react";
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
import type { AnalystWorkspaceSelection } from "@/components/analyst-workspace-selection";
import { AgentImageAttachments } from "@/components/agent-image-attachments";
import {
  AgentActivityTimeline,
  AnalystReport,
  PendingAgentMessageImages,
  SavedConversationEntries,
  pendingPhaseLabel,
} from "@/components/portfolio-analyst-transcript";
import { pendingAgentActions, currentAgentAction, type PendingAgentAction } from "@/components/agent-pending-actions";
import { MAX_PORTFOLIO_ANALYST_MEMORY_CHARS } from "@/application/portfolio-analyst-memory";
import { AgentDraftReviewPanel } from "@/components/agent-draft-review-panel";
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
  onViewDetail,
  questionRequest,
  onQuestionAvailabilityChange,
}: {
  blocked?: boolean;
  onPortfolioChanged?: () => void;
  onViewDetail?: (selection: AnalystWorkspaceSelection) => void;
  questionRequest?: { id: number; text: string };
  onQuestionAvailabilityChange?: (available: boolean) => void;
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
  const [reviewPanel, setReviewPanel] = useState<"sale" | "memory" | "sources" | "import" | "price-source">();
  const [selectedActionKey, setSelectedActionKey] = useState<string>();
  const [selectedReviewId, setSelectedReviewId] = useState<string>();
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const includeHoldingNames = true;
  const [conversation, setConversation] = useState<PortfolioAnalystConversation>();
  const [pendingTurnImageId, setPendingTurnImageId] = useState<string>();
  const [pendingTurn, setPendingTurn] = useState<PendingPortfolioAnalystTurn>();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [priceSourceReviewBusy, setPriceSourceReviewBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [memoryReviewBusy, setMemoryReviewBusy] = useState(false);
  const [actionCancelBusy, setActionCancelBusy] = useState(false);
  const [actionCancelError, setActionCancelError] = useState("");
  const [memoryReviewError, setMemoryReviewError] = useState("");
  const [importAttachments, setImportAttachments] = useState<AgentImageAttachmentState<File>>(
    () => createAgentImageAttachmentState<File>(),
  );
  const [pendingImageMessage, setPendingImageMessage] = useState<{ text: string; files: readonly File[] }>();
  const [importReviewHost, setImportReviewHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setImportReviewHost(document.getElementById("agent-import-review-host")); }, []);
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
        if (restored) {
          try { setSelectedActionKey(window.localStorage.getItem(`agent-current-action:${restored.id}`) ?? undefined); }
          catch { /* Unavailable storage does not prevent draft review. */ }
        }
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
    if (!conversation || loading || importBusy || memoryReviewBusy || actionCancelBusy) return;
    setMemoryReviewBusy(true);
    setMemoryReviewError("");
    try {
      await saveQueue.current;
      if (action === "save" && saveErrors.current[`memory:${turnId}`]) throw new Error("Fix the memory draft save error before confirming.");
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
      setReviewPanel(undefined);
    } catch (cause) {
      setMemoryReviewError(cause instanceof Error ? cause.message : "Memory review could not be completed.");
    } finally {
      setMemoryReviewBusy(false);
    }
  }

  async function sendImageMessage(
    submission: NonNullable<ReturnType<typeof createAgentComposerSubmission<File>>>,
  ) {
    if (loading || importBusy || memoryReviewBusy || actionCancelBusy) return;
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
    if (!conversation || loading || importBusy || memoryReviewBusy || actionCancelBusy) return;
    setImportBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/portfolio/analyst/workflow/reply", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, turnId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.conversation) throw new Error("Gator’s reply could not be retried.");
      setConversation(payload.conversation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gator’s reply could not be retried."); }
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

  function editMemoryDraft(turnId: string, content: string) {
    if (loading || importBusy || memoryReviewBusy || actionCancelBusy) return;
    const key = `memory:${turnId}`;
    const revision = (saveRevision.current[key] ?? 0) + 1;
    saveRevision.current[key] = revision;
    saveErrors.current[key] = false;
    setSaveStatus((current) => ({ ...current, [key]: "saving" }));
    setConversation((current) => current ? { ...current, turns: current.turns.map((turn) =>
      turn.id === turnId && turn.chat?.memoryProposal ? { ...turn, chat: { ...turn.chat,
        memoryProposal: { ...turn.chat.memoryProposal, content } } } : turn) } : current);
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      // Skip superseded keystrokes; keep the same queue as manual import saves.
      if (saveRevision.current[key] !== revision) return;
      const response = await fetch("/api/portfolio/analyst/memory", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation?.id, turnId, action: "update", content }),
      });
      if (!response.ok) throw new Error("Memory draft save failed.");
      if (saveRevision.current[key] === revision) setSaveStatus((current) => ({ ...current, [key]: "saved" }));
    }).catch(() => {
      if (saveRevision.current[key] === revision) {
        saveErrors.current[key] = true;
        setSaveStatus((current) => ({ ...current, [key]: "error" }));
      }
    });
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
    if (!selectedProvider?.configured || loading || memoryReviewBusy || actionCancelBusy || !normalizedQuestion) return;
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
      if (Object.entries(saveErrors.current).some(([key, failed]) => key.startsWith("memory:") && failed)) {
        throw new Error("Please fix the memory draft save error before continuing.");
      }
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
            if (newDraft) { setSelectedReviewId(newDraft.id); setSelectedActionKey(`import:${newDraft.id}`); setReviewPanel("import"); }
          }
          const latestTurn = event.conversation.turns.at(-1);
          if (latestTurn?.priceSourceReview?.status === "pending") {
            setSelectedActionKey(`price-source:${latestTurn.id}`); setSelectedEvidenceId(undefined); setReviewPanel("price-source");
          }
          if (latestTurn?.chat?.saleDraft?.status === "pending") {
            setSelectedActionKey(`sale:${latestTurn.id}`);
            setReviewPanel(undefined);
          }
          if (latestTurn?.chat?.memoryProposal?.status === "pending") {
            setSelectedEvidenceId(undefined);
            setMemoryReviewError("");
            setSelectedActionKey(`memory:${latestTurn.id}`);
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
    if (loading || importBusy || memoryReviewBusy || actionCancelBusy) return;
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
      setSelectedActionKey(undefined);
      setReviewPanel(undefined);
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

  const actions = pendingAgentActions(conversation, importDrafts);
  const currentAction = currentAgentAction(actions, selectedActionKey);
  const importAction = currentAction?.kind === "import" ? currentAction
    : actions.find((action) => action.kind === "import" && action.id === selectedReviewId)
      ?? actions.find((action) => action.kind === "import");
  const activeReview = conversation?.importActivities.find((activity) => activity.draftId === importAction?.id);
  const activeDraft = activeReview && importDrafts[activeReview.draftId]?.status === "draft"
    ? importDrafts[activeReview.draftId] : undefined;
  const activeDateRequest = activeDraft && nextImportDateFollowUp(activeDraft);
  const selectedEvidenceTurn = conversation?.turns.find((turn) => turn.id === selectedEvidenceId && turn.report);
  const activeSaleTurn = conversation?.turns.findLast((turn) => turn.chat?.saleDraft?.status === "pending");
  const pendingPriceSourceTurn = currentAction?.kind === "price-source"
    ? conversation?.turns.find((turn) => turn.id === currentAction.id) : undefined;
  const pendingMemoryTurn = currentAction?.kind === "memory"
    ? conversation?.turns.find((turn) => turn.id === currentAction.id) : undefined;

  // Keep the highlighted item after closing a panel and across refreshes.
  useEffect(() => {
    if (!conversation) return;
    try {
      const key = `agent-current-action:${conversation.id}`;
      if (currentAction) window.localStorage.setItem(key, currentAction.key);
      else window.localStorage.removeItem(key);
    } catch { /* Fall back to the most recent saved item when storage is unavailable. */ }
  }, [conversation?.id, currentAction?.key]);

  useEffect(() => {
    if (selectedActionKey && !actions.some((action) => action.key === selectedActionKey)
      && reviewPanel !== "sources") setReviewPanel(undefined);
  }, [selectedActionKey, currentAction?.key, reviewPanel]);

  function openAction(action: PendingAgentAction) {
    if (actionSwitchBusy) return;
    setSelectedActionKey(action.key);
    if (action.kind === "import") setSelectedReviewId(action.id);
    setSelectedEvidenceId(undefined);
    setMemoryReviewError("");
    setReviewPanel(action.kind);
    setActionCancelError("");
  }

  function actionLabel(action: PendingAgentAction) {
    return action.kind === "price-source" ? (language === "zh-CN" ? `价格源审核 · ${action.label ?? ""}` : `Price source review · ${action.label ?? ""}`)
      : action.kind === "import"
      ? (language === "zh-CN" ? "导入草稿" : "Import draft")
      : action.kind === "sale" ? (language === "zh-CN" ? "卖出草稿" : "Sale draft")
      : (language === "zh-CN" ? "记忆草稿" : "Memory draft");
  }
  const actionSwitchBusy = priceSourceReviewBusy || loading || importBusy || memoryReviewBusy || actionCancelBusy || Object.values(saveStatus).includes("saving");
  const canFillQuestion = !blocked && !actionSwitchBusy && Boolean(selectedProvider?.configured) && !question.trim();
  const consumedQuestionRequest = useRef<number | undefined>(undefined);
  useEffect(() => { onQuestionAvailabilityChange?.(canFillQuestion); }, [canFillQuestion, onQuestionAvailabilityChange]);
  useEffect(() => {
    if (!questionRequest || consumedQuestionRequest.current === questionRequest.id) return;
    consumedQuestionRequest.current = questionRequest.id;
    if (!canFillQuestion) return;
    setQuestion(questionRequest.text);
    composer.current?.focus();
  }, [questionRequest, canFillQuestion]);
  const closeReviewLabel = language === "zh-CN" ? "收起审核，保留草稿" : "Close review and keep draft";

  async function cancelAction(action: PendingAgentAction) {
    if (!conversation || actionSwitchBusy) return;
    setActionCancelBusy(true);
    setActionCancelError("");
    try {
      await saveQueue.current;
      const response = await fetch("/api/portfolio/analyst/pending-actions", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, kind: action.kind, id: action.id }),
      });
      const payload = await response.json() as { conversation?: PortfolioAnalystConversation; importDrafts?: ImportDraftReadModel[]; error?: string };
      if (!response.ok || !payload.conversation || !payload.importDrafts) throw new Error(payload.error ?? "Draft cancellation failed.");
      setConversation(payload.conversation);
      importDraftsRef.current = Object.fromEntries(payload.importDrafts.map((draft) => [draft.id, draft]));
      setImportDrafts(importDraftsRef.current);
      delete saveErrors.current[action.kind === "memory" ? `memory:${action.id}` : action.id];
      if (action.key === currentAction?.key) setReviewPanel(undefined);
    } catch (cause) {
      setActionCancelError(cause instanceof Error ? cause.message : "Draft cancellation failed.");
    } finally { setActionCancelBusy(false); }
  }

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
            <Image src="/brand/aggregator-icon-192.png" alt="" width={42} height={42} />
            <div>
              <h2 id="portfolio-analyst-title">Gator</h2>
              <p>{language === "zh-CN" ? "随时接着聊，也可以分享截图。" : "Pick up anytime. Questions or screenshots welcome."}</p>
            </div>
          </div>
          <div className="agent-header-actions">
            <button type="button" aria-pressed={focusedChat} aria-label={language === "zh-CN" ? "专注聊天" : "Focus chat"} title={language === "zh-CN" ? "专注聊天" : "Focus chat"} onClick={() => setFocusedChat(!focusedChat)}>
              {focusedChat ? <Shrink size={17} /> : <Expand size={17} />}
            </button>
            <details ref={conversationMenu} className="agent-manage-menu">
              <summary ref={conversationOptions} aria-label={language === "zh-CN" ? "对话管理" : "Conversation options"}><MoreHorizontal size={18} aria-hidden="true" /></summary>
              <div>
                <details className="agent-answer-history"><summary>{language === "zh-CN" ? "回答详情" : "Answer details"}</summary>
                  {conversation?.turns.filter((turn) => turn.report).map((turn) => <button type="button" key={turn.id} onClick={(event) => {
                    event.currentTarget.closest(".agent-manage-menu")?.removeAttribute("open");
                    conversationOptions.current?.focus();
                    setSelectedEvidenceId(turn.id); setReviewPanel("sources");
                  }}>{turn.question || new Date(turn.report!.generatedAt).toLocaleString()}</button>)}
                </details>
                <button type="button" disabled={!conversation || loading || importBusy} onClick={(event) => {
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
            Add your OpenAI API key in <a href="/settings">Settings → AI provider</a>.
          </p>
        )}
        <AnalystConversationView language={language} sending={Boolean(pendingTurn?.phase === "sending" || pendingImageMessage)}>
          {!conversation?.turns.length && !conversation?.importActivities.length && !pendingTurn && (
            <div className="analyst-conversation-empty">
              <h3>{language === "zh-CN" ? "认识 Gator，让投资组合更清晰。" : "Meet Gator. Make sense of your portfolio."}</h3>
              <p>{language === "zh-CN" ? "一起看看你的资产，或从一个问题开始。" : "Let’s look at your portfolio, or start with a question."}</p>
              <div className="analyst-starter-grid">
                {starterQuestions[language].map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    disabled={loading || priceSourceReviewBusy || !selectedProvider?.configured}
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
            loading={loading}
            importBusy={importBusy}
            onConfirmCreateAccount={(turnId, action) => void confirmCreateAccount(turnId, action)}
            onViewDetail={onViewDetail && !actionSwitchBusy ? (selection) => {
              setReviewPanel(undefined);
              setFocusedChat(false);
              onViewDetail(selection);
            } : undefined}
            onFollowUp={!loading && !importBusy && !memoryReviewBusy && !actionCancelBusy && selectedProvider?.configured && !question.trim() ? (prompt) => { setQuestion(prompt); composer.current?.focus(); } : undefined}
            onReviewDraft={(draftId) => {
              const action = actions.find((item) => item.kind === "import" && item.id === draftId);
              if (action) openAction(action);
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
                    onClick={retryFailedTurn} disabled={loading || importBusy || priceSourceReviewBusy}>
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
        {actions.length > 0 && <div className="agent-review-launchers" aria-label={language === "zh-CN" ? "待办事项" : "Pending items"}>
          {actions.map((action) => <div className={`agent-pending-item${action.key === currentAction?.key ? " current" : ""}`} key={action.key}>
            <button type="button" className="agent-pending-open" disabled={actionSwitchBusy} aria-pressed={action.key === currentAction?.key}
              title={actionLabel(action)} onClick={() => openAction(action)}>{actionLabel(action)}</button>
            <button type="button" className="agent-pending-cancel" disabled={actionSwitchBusy} onClick={() => void cancelAction(action)}
              aria-label={`${language === "zh-CN" ? "取消待办" : "Cancel pending item"}: ${actionLabel(action)}`}
              title={language === "zh-CN" ? "取消草稿" : "Cancel draft"}><X size={15} aria-hidden="true" /></button>
          </div>)}
          {actionCancelError && <p role="alert" className="error-message">{actionCancelError}</p>}
        </div>}
        <div className="analyst-composer">
          <div className="analyst-composer-box">
            <textarea
              ref={composer}
              rows={2}
              maxLength={MAX_PORTFOLIO_ANALYST_QUESTION_CHARS}
              disabled={loading || importBusy || memoryReviewBusy || priceSourceReviewBusy || actionCancelBusy || !selectedProvider?.configured}
              value={question}
              aria-label={language === "zh-CN" ? "给 Gator 发送消息" : "Message Gator"}
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
                    disabled={priceSourceReviewBusy || memoryReviewBusy || actionCancelBusy || !selectedProvider?.configured || (!question.trim() && importAttachments.files.length === 0)}>
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
          <button type="button" className="destructive" disabled={loading || importBusy || priceSourceReviewBusy} onClick={() => {
            setDeleteDialogOpen(false);
            void resetConversation();
          }}>{language === "zh-CN" ? "删除记录" : "Delete history"}</button>
        </div>
      </dialog>
      {conversation && activeSaleTurn?.chat?.saleDraft && importReviewHost && createPortal(
        <AgentDraftReviewPanel title={language === "zh-CN" ? "核对卖出草稿" : "Review sale draft"} closeLabel={closeReviewLabel}
          hidden={reviewPanel !== "sale" || currentAction?.key !== selectedActionKey || currentAction?.kind !== "sale"}
          busy={actionSwitchBusy} onClose={() => setReviewPanel(undefined)}>
          <AgentSaleDraftReview key={activeSaleTurn.id} conversationId={conversation.id} turnId={activeSaleTurn.id}
            draft={activeSaleTurn.chat.saleDraft} language={language} onConversation={setConversation}
            disabled={loading || importBusy || memoryReviewBusy || priceSourceReviewBusy || actionCancelBusy} onBusy={setImportBusy}
            onSaved={() => { setReviewPanel(undefined); onPortfolioChanged?.(); }} />
        </AgentDraftReviewPanel>, importReviewHost
      )}
      {pendingPriceSourceTurn?.priceSourceReview && conversation && reviewPanel === "price-source" && currentAction?.key === selectedActionKey && importReviewHost && createPortal(
        <AgentDraftReviewPanel title={language === "zh-CN" ? "价格源审核" : "Price source review"} closeLabel={closeReviewLabel}
          busy={actionSwitchBusy} onClose={() => setReviewPanel(undefined)}>
          <AgentPriceSourceReviewContent key={pendingPriceSourceTurn.id} review={pendingPriceSourceTurn.priceSourceReview}
            conversationId={conversation.id} turnId={pendingPriceSourceTurn.id} language={language} busy={actionSwitchBusy}
            setBusy={setPriceSourceReviewBusy} onConfirmed={(saved) => { setConversation(saved); setReviewPanel(undefined); }}
            onCancel={() => void cancelAction(currentAction!)} />
        </AgentDraftReviewPanel>, importReviewHost)}
      {pendingMemoryTurn?.chat?.memoryProposal && reviewPanel === "memory" && currentAction?.key === selectedActionKey && importReviewHost && createPortal(
        <AgentDraftReviewPanel title={language === "zh-CN" ? "核对记忆草稿" : "Review memory draft"} closeLabel={closeReviewLabel}
          busy={actionSwitchBusy} onClose={() => setReviewPanel(undefined)}>
          <section className="home-review-panel home-memory-review" aria-label="Review memory">
            <div className="home-review-panel-heading">
              <div><p className="eyebrow">MEMORY REVIEW</p><h2>{language === "zh-CN" ? "确认这条记忆" : "Confirm this memory"}</h2></div>
            </div>
            <p>{language === "zh-CN" ? "草稿已保留，可稍后确认。确认后用于以后对话，不会更改持仓。" : "This draft is kept for later review. Confirming saves it for future conversations and does not change holdings."}</p>
            <label className="agent-memory-draft-field">
              <span>{language === "zh-CN" ? "记忆内容 · 可修改" : "Memory content · editable"}</span>
              <textarea rows={3} maxLength={MAX_PORTFOLIO_ANALYST_MEMORY_CHARS}
                disabled={loading || importBusy || memoryReviewBusy || priceSourceReviewBusy || actionCancelBusy}
                value={pendingMemoryTurn.chat.memoryProposal.content}
                onChange={(event) => editMemoryDraft(pendingMemoryTurn.id, event.target.value)} />
            </label>
            <small role="status">{saveStatus[`memory:${pendingMemoryTurn.id}`] === "saving"
              ? (language === "zh-CN" ? "正在保存草稿…" : "Saving draft…")
              : saveStatus[`memory:${pendingMemoryTurn.id}`] === "error"
                ? (language === "zh-CN" ? "草稿未保存。请输入 1–200 字的单行内容，不含密码或密钥。" : "Draft not saved. Use 1–200 characters on one line without secrets.")
                : (language === "zh-CN" ? "草稿已保留，确认后才成为长期记忆。" : "Draft kept; it becomes a saved memory only after confirmation.")}</small>
            {memoryReviewError && <p role="alert" className="error-message">{memoryReviewError}</p>}
            <div className="home-memory-review-actions">
              <button type="button" disabled={actionSwitchBusy || saveStatus[`memory:${pendingMemoryTurn.id}`] === "error"} onClick={() => void resolveMemoryProposal("save", pendingMemoryTurn.id)}>{memoryReviewBusy ? (language === "zh-CN" ? "正在保存…" : "Saving…") : language === "zh-CN" ? "确认保存" : "Save memory"}</button>
              <button type="button" className="secondary" disabled={actionSwitchBusy} onClick={() => setReviewPanel(undefined)}>{language === "zh-CN" ? "稍后处理" : "Review later"}</button>
              <button type="button" disabled={actionSwitchBusy} onClick={() => void cancelAction(currentAction!)}>{language === "zh-CN" ? "取消草稿" : "Cancel draft"}</button>
            </div>
          </section>
        </AgentDraftReviewPanel>, importReviewHost
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
              setReviewPanel(undefined);
              window.requestAnimationFrame(() => conversationOptions.current?.focus());
            }} aria-label="Close sources">×</button>
          </div>
          <div className="home-review-scroll">
            <AnalystReport report={selectedEvidenceTurn.report} sourcesOnly />
          </div>
        </section>
        </ReviewDialog>
      )}
      {currentAction?.kind === "import" && currentAction.key === selectedActionKey && activeReview && activeDraft && reviewPanel === "import" && importReviewHost && createPortal(
        <AgentDraftReviewPanel title={language === "zh-CN" ? "核对导入 · 可继续在左侧对话中修改" : "Review import · Continue editing in chat"}
          closeLabel={closeReviewLabel} busy={actionSwitchBusy} onClose={() => setReviewPanel(undefined)}>

        <section className="home-review-panel" aria-label={`Review ${activeReview.targetLabel} import`}>
          <div className="home-review-panel-heading">
            <div><p className="eyebrow">IMPORT REVIEW</p><h2>Review {activeReview.targetLabel}</h2></div>
            <span>Changes apply after confirmation</span>
          </div>
          <div className="home-review-scroll">
            {error && <p role="alert" className="error-message">{error}</p>}
            <fieldset className="agent-import-review-fields" disabled={loading || importBusy || memoryReviewBusy || priceSourceReviewBusy || actionCancelBusy}>
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
            </fieldset>
          </div>
        </section>
        </AgentDraftReviewPanel>, importReviewHost
      )}
    </div>
  );
}
