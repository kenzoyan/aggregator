"use client";

import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  PortfolioAnalystAgentAudit,
  PortfolioAnalystToolActivity,
  PortfolioAnalystToolName,
} from "@/application/portfolio-analyst-agent";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystImageAttachment } from "@/application/portfolio-analyst-conversation";
import { pendingScreenshotImportTarget, requestsScreenshotImport } from "@/application/agent-image-intent";
import { consumePortfolioAnalystImageStream } from "@/application/portfolio-analyst-image-stream";
import type {
  AnalystEvidenceFact,
  FactualUpdate,
  PortfolioAnalystLanguage,
} from "@/application/portfolio-analyst-contract";
import {
  readPortfolioAnalystPreferences,
  resolvePortfolioAnalystConversationSettings,
  type PortfolioAnalystProviderAvailability,
} from "@/application/portfolio-analyst-preferences";
import {
  portfolioAnalystActionLabel,
  portfolioAnalystEvidenceValue,
  portfolioAnalystLimitationLabel,
} from "@/application/portfolio-analyst-presentation";
import type {
  PortfolioAnalystProviderId,
  PortfolioAnalystReport,
} from "@/application/portfolio-analyst-provider";
import type { Period } from "@/application/portfolio-read-model";
import {
  createImportDraftConfirmationPayload,
  type ImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import {
  importDateFollowUpQuestion,
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
import { AssistantMessageContent } from "@/components/assistant-message-content";
import {
  createAgentImportAnalysisForm,
  resolveAgentImportSourceAccount,
  type AgentImportAccountOption,
} from "@/components/agent-import-analysis";
import { AgentImportDraftReview } from "@/components/agent-import-draft-review";
import {
  applyPortfolioAnalystStreamEvent,
  beginPendingPortfolioAnalystTurn,
  consumePortfolioAnalystStream,
  portfolioAnalystStreamContentType,
  type PendingPortfolioAnalystTurn,
} from "@/application/portfolio-analyst-stream";

interface AnalystConfiguration {
  defaultProvider: PortfolioAnalystProviderId;
  providers: Array<PortfolioAnalystProviderAvailability & {
    model: string;
  }>;
  conversation?: PortfolioAnalystConversation;
  importDrafts?: ImportDraftReadModel[];
}

type StartAccountImportAction = Extract<FactualUpdate, { kind: "start-account-import" }>;

const providerNames: Record<PortfolioAnalystProviderId, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

const classificationLabels: Record<
  PortfolioAnalystAnswer["answer"]["classification"],
  string
> = {
  fact: "Fact",
  calculation: "Calculation",
  estimate: "Estimate",
  interpretation: "Interpretation",
};

const starterQuestions = {
  "zh-CN": [
    "今天我的投资组合表现怎么样？",
    "最近 7 天哪些持仓对组合影响最大？",
    "当前资产数据有哪些需要更新？",
    "帮我创建一个新的投资账户。",
  ],
  en: [
    "How is my portfolio performing today?",
    "Which holdings affected my portfolio most over the last 7 days?",
    "Which portfolio data needs updating?",
    "Help me create a new investment account.",
  ],
} as const;

export function PortfolioAnalyst({
  blocked = false,
  reviewHost,
  onPortfolioChanged,
}: {
  blocked?: boolean;
  reviewHost?: HTMLElement | null;
  onPortfolioChanged?: () => void;
}) {
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const conversationView = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const [configuration, setConfiguration] = useState<AnalystConfiguration>();
  const [provider, setProvider] = useState<PortfolioAnalystProviderId>("openai");
  const [period, setPeriod] = useState<Period>("week");
  const [language, setLanguage] = useState<PortfolioAnalystLanguage>("en");
  const [selectedReviewId, setSelectedReviewId] = useState<string>();
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const [includeHoldingNames, setIncludeHoldingNames] = useState(true);
  const [conversation, setConversation] = useState<PortfolioAnalystConversation>();
  const [pendingTurn, setPendingTurn] = useState<PendingPortfolioAnalystTurn>();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [accountOptions, setAccountOptions] = useState<AgentImportAccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [importAttachments, setImportAttachments] = useState<AgentImageAttachmentState<File>>(
    () => createAgentImageAttachmentState<File>(),
  );
  const [pendingImageMessage, setPendingImageMessage] = useState<{ text: string; files: readonly File[] }>();
  const [pendingImportReply, setPendingImportReply] = useState<string>();
  const [answeringImageTurnId, setAnsweringImageTurnId] = useState<string>();
  const [streamedImageAnswer, setStreamedImageAnswer] = useState("");
  const [importDrafts, setImportDrafts] = useState<Record<string, ImportDraftReadModel>>({});
  const importDraftsRef = useRef<Record<string, ImportDraftReadModel>>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef<Record<string, number>>({});
  const pendingImportRoute = useRef<PortfolioAnalystConversation | undefined>(undefined);
  const saveErrors = useRef<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [accountActionStatus, setAccountActionStatus] = useState<Record<
    string,
    "confirming" | "created" | "failed"
  >>({});
  const selectedProvider = configuration?.providers.find((item) => item.id === provider);
  const activeImportTarget = pendingScreenshotImportTarget(conversation);

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
        setIncludeHoldingNames(settings.includeHoldingNames);
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
    const view = conversationView.current;
    if (view) view.scrollTop = view.scrollHeight;
  }, [conversation?.updatedAt, conversation?.turns.length, Object.keys(importDrafts).length, pendingTurn?.answerText, pendingImageMessage, pendingImportReply]);

  useEffect(() => () => { activeRequest.current?.abort(); }, []);

  async function analyzeAccountImport(
    submission: NonNullable<ReturnType<typeof createAgentComposerSubmission<File>>>,
    target: StartAccountImportAction | undefined,
    currentConversation: PortfolioAnalystConversation,
    chosenAccountId = "",
  ) {
    if (submission.screenshots.length === 0 || importBusy) return;
    setImportBusy(true);
    setError(undefined);
    setImportAttachments((current) => lockAgentImageAttachments(current));
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const accountsResponse = await fetch("/api/accounts", {
        cache: "no-store",
        signal: controller.signal,
      });
      const accountsPayload = (await accountsResponse.json()) as {
        accounts?: AgentImportAccountOption[];
        error?: string;
      };
      if (!accountsResponse.ok || !accountsPayload.accounts) {
        throw new Error(accountsPayload.error ?? "Source accounts could not be loaded.");
      }
      const eligibleAccounts = accountsPayload.accounts.filter((candidate) => candidate.updateMethod === "Screenshot");
      const account = chosenAccountId
        ? eligibleAccounts.find((candidate) => candidate.id === chosenAccountId)
        : (target && resolveAgentImportSourceAccount(eligibleAccounts, target.accountType))
          ?? (eligibleAccounts.length === 1 ? eligibleAccounts[0] : undefined);
      if (!account) {
        setAccountOptions(eligibleAccounts);
        throw new Error(eligibleAccounts.length === 0
          ? (language === "zh-CN" ? "还没有可接收截图的账户，请先在账户页添加。" : "Add a screenshot account on the Accounts page first.")
          : (language === "zh-CN" ? "请选择截图所属账户，再发送一次。" : "Choose the screenshot account and send again."));
      }
      const response = await fetch("/api/imports/analyze", {
        method: "POST",
        body: createAgentImportAnalysisForm(account.id, submission.screenshots),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        draft?: ImportDraftReadModel;
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Image analysis failed.");
      }
      const activityResponse = await fetch("/api/portfolio/analyst", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: currentConversation.id,
          draftId: payload.draft.id,
          targetLabel: account.label,
          submissionText: submission.text,
          screenshotCount: submission.screenshots.length,
        }),
        signal: controller.signal,
      });
      const activityPayload = (await activityResponse.json()) as {
        conversation?: PortfolioAnalystConversation;
        importDraft?: ImportDraftReadModel;
        error?: string;
      };
      if (!activityResponse.ok || !activityPayload.conversation || !activityPayload.importDraft) {
        throw new Error(activityPayload.error ?? "The import draft could not be saved to this conversation.");
      }
      setConversation(activityPayload.conversation);
      importDraftsRef.current = { ...importDraftsRef.current, [activityPayload.importDraft.id]: activityPayload.importDraft };
      setImportDrafts(importDraftsRef.current);
      setSelectedEvidenceId(undefined);
      setSelectedReviewId(activityPayload.importDraft.id);
      pendingImportRoute.current = undefined;
      setSelectedAccountId("");
      setAccountOptions([]);
      setImportAttachments((current) => resetAgentImageAttachments(current));
      setQuestion("");
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "Image analysis failed.");
        setQuestion(submission.text);
      }
    } finally {
      activeRequest.current = undefined;
      setImportAttachments((current) => unlockAgentImageAttachments(current));
      setImportBusy(false);
    }
  }

  function submitComposer() {
    const submission = createAgentComposerSubmission({
      text: question,
      screenshots: importAttachments.files,
    });
    if (!submission) return;
    if (submission.screenshots.length > 0) {
      if (requestsScreenshotImport(submission.text, Boolean(activeImportTarget || selectedAccountId))) {
        void submitScreenshotImport(submission, activeImportTarget);
      } else {
        void submitImageQuestion(submission);
      }
      return;
    }
    if (activeReview) {
      void submitImportMessage(activeReview.draftId, submission.text);
      return;
    }
    void runAnalyst(submission.text);
  }

  async function submitImportMessage(draftId: string, userText: string) {
    if (!conversation || loading || importBusy) return;
    setImportBusy(true);
    setPendingImportReply(userText);
    setError(undefined);
    let delegate = false;
    try {
      await saveQueue.current;
      if (saveErrors.current[draftId]) throw new Error("Please fix the draft save error before continuing.");
      const response = await fetch("/api/portfolio/analyst/import-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: crypto.randomUUID(), conversationId: conversation.id, draftId, message: userText }),
      });
      const payload = await response.json() as {
        conversation?: PortfolioAnalystConversation;
        draft?: ImportDraftReadModel;
        delegate?: boolean;
        cancelled?: boolean;
        portfolioChanged?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "I couldn't complete that request. Please try again.");
      if (payload.delegate) {
        delegate = true;
      } else {
        if (!payload.conversation) throw new Error("I couldn't save the chat reply. Please refresh and check the draft.");
        setConversation(payload.conversation);
        if (payload.cancelled) {
          const remaining = { ...importDraftsRef.current };
          delete remaining[draftId];
          importDraftsRef.current = remaining;
          setImportDrafts(remaining);
          setSelectedReviewId(undefined);
        } else if (payload.draft) {
          importDraftsRef.current = { ...importDraftsRef.current, [draftId]: payload.draft };
          setImportDrafts(importDraftsRef.current);
          if (payload.portfolioChanged) {
            setSelectedReviewId(undefined);
            onPortfolioChanged?.();
          }
        }
        setQuestion("");
        setPendingTurn(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "I couldn't complete that request. Please try again.");
    } finally {
      setPendingImportReply(undefined);
      setImportBusy(false);
    }
    if (delegate) void runAnalyst(userText);
  }

  function retryFailedTurn() {
    if (!pendingTurn || loading || importBusy) return;
    const text = pendingTurn.question;
    setPendingTurn(undefined);
    setError(undefined);
    if (activeReview) void submitImportMessage(activeReview.draftId, text);
    else void runAnalyst(text);
  }

  async function submitImageQuestion(
    submission: NonNullable<ReturnType<typeof createAgentComposerSubmission<File>>>,
  ) {
    if (loading || importBusy) return;
    if (provider !== "openai") {
      setError("Image questions require OpenAI. Select OpenAI in Settings.");
      return;
    }
    setImportBusy(true);
    setError(undefined);
    setPendingImageMessage({ text: submission.text, files: submission.screenshots });
    setImportAttachments((current) => lockAgentImageAttachments(current));
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const form = new FormData();
      form.set("userText", submission.text);
      form.set("language", language);
      form.set("includeHoldingNames", String(includeHoldingNames));
      if (conversation) form.set("conversationId", conversation.id);
      submission.screenshots.forEach((file) => form.append("images", file));
      const response = await fetch("/api/portfolio/analyst/images/ask", {
        method: "POST", body: form, signal: controller.signal,
      });
      const payload = await response.json() as { conversation?: PortfolioAnalystConversation; error?: string };
      if (!response.ok || !payload.conversation) {
        throw new Error(payload.error ?? "The image could not be analyzed.");
      }
      setConversation(payload.conversation);
      setPendingTurn(undefined);
      setPendingImageMessage(undefined);
      setQuestion("");
      setImportAttachments((current) => resetAgentImageAttachments(current));
      const turnId = payload.conversation.turns.at(-1)?.id;
      if (!turnId) throw new Error("The sent image message could not be found.");
      setAnsweringImageTurnId(turnId);
      await completeImageAnswer(turnId, controller.signal);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The image could not be analyzed.");
      }
    } finally {
      setPendingImageMessage(undefined);
      setAnsweringImageTurnId(undefined);
      setStreamedImageAnswer("");
      activeRequest.current = undefined;
      setImportAttachments((current) => unlockAgentImageAttachments(current));
      setImportBusy(false);
    }
  }

  async function retryImageQuestion(turnId: string) {
    if (loading || importBusy) return;
    setImportBusy(true);
    setAnsweringImageTurnId(turnId);
    setStreamedImageAnswer("");
    setError(undefined);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      await completeImageAnswer(turnId, controller.signal);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The image could not be analyzed.");
      }
    } finally {
      activeRequest.current = undefined;
      setAnsweringImageTurnId(undefined);
      setStreamedImageAnswer("");
      setImportBusy(false);
    }
  }

  async function completeImageAnswer(turnId: string, signal: AbortSignal) {
    const response = await fetch(`/api/portfolio/analyst/images/ask/${encodeURIComponent(turnId)}`, {
      method: "POST",
      headers: { accept: "application/x-ndjson" },
      signal,
    });
    let finished = false;
    let failure: string | undefined;
    await consumePortfolioAnalystImageStream(response, (event) => {
      if (event.type === "delta") {
        setStreamedImageAnswer((current) => current + event.delta);
      } else if (event.type === "completed") {
        finished = true;
        setConversation(event.conversation);
        if (event.error) setError(event.error);
      } else {
        failure = event.error;
      }
    });
    if (failure) throw new Error(failure);
    if (!finished) throw new Error("The image response ended before completion.");
  }

  async function submitScreenshotImport(
    submission: NonNullable<ReturnType<typeof createAgentComposerSubmission<File>>>,
    activeTarget?: StartAccountImportAction,
  ) {
    setPendingImageMessage({ text: submission.text, files: submission.screenshots });
    setImportAttachments((current) => lockAgentImageAttachments(current));
    const prompt = activeTarget
      ? (language === "zh-CN"
          ? `请将截图中的资产导入已登记的 ${activeTarget.label}（${activeTarget.accountType}）账户。${submission.text}`
          : `Import the assets in these screenshots into my registered ${activeTarget.label} (${activeTarget.accountType}) account. ${submission.text}`)
      : submission.text || (language === "zh-CN"
          ? "请帮我识别截图中的资产，并准备导入已登记的账户。"
          : "Identify the assets in my screenshots and prepare an import into a registered account.");
    const routed = pendingImportRoute.current ?? await runAnalyst(prompt, submission.screenshots.length);
    if (!routed) {
      setPendingImageMessage(undefined);
      setPendingTurn(undefined);
      setQuestion(submission.text);
      setImportAttachments((current) => unlockAgentImageAttachments(current));
      return;
    }
    pendingImportRoute.current = routed;
    const message = routed.turns.at(-1);
    if (!message) {
      setPendingImageMessage(undefined);
      setError("The image message could not be found.");
      setImportAttachments((current) => unlockAgentImageAttachments(current));
      return;
    }
    let savedConversation = routed;
    if (!message.attachments?.length) {
      setImportBusy(true);
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        const form = new FormData();
        form.set("conversationId", routed.id);
        form.set("turnId", message.id);
        form.set("userText", submission.text);
        submission.screenshots.forEach((file) => form.append("images", file));
        const response = await fetch("/api/portfolio/analyst/images", {
          method: "POST", body: form, signal: controller.signal,
        });
        const payload = await response.json() as {
          conversation?: PortfolioAnalystConversation;
          error?: string;
        };
        if (!response.ok || !payload.conversation) {
          throw new Error(payload.error ?? "Images could not be saved to the conversation.");
        }
        savedConversation = payload.conversation;
        pendingImportRoute.current = savedConversation;
      } catch (cause) {
        setPendingImageMessage(undefined);
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Images could not be saved.");
        }
        setQuestion(submission.text);
        setImportAttachments((current) => unlockAgentImageAttachments(current));
        return;
      } finally {
        activeRequest.current = undefined;
        setImportBusy(false);
      }
    }
    setConversation(savedConversation);
    setPendingImageMessage(undefined);
    const proposed = routed.turns.findLast((turn) => turn.report)?.report?.answer.proposedUpdate;
    const target = activeTarget ?? (proposed?.kind === "start-account-import" ? proposed : undefined);
    await analyzeAccountImport(submission, target, savedConversation, selectedAccountId);
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
        error?: string;
      };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Confirmation failed.");
      }
      importDraftsRef.current = { ...importDraftsRef.current, [draftId]: payload.draft };
      setImportDrafts(importDraftsRef.current);
      pendingImportRoute.current = undefined;
      setImportAttachments((current) => resetAgentImageAttachments(current));
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

  async function runAnalyst(requestedQuestion?: string, screenshotCount = 0) {
    const submission = createAgentComposerSubmission({
      text: requestedQuestion ?? question,
      screenshots: [],
    });
    const normalizedQuestion = readTextOnlyAgentQuestion(submission);
    if (!selectedProvider?.configured || loading || !normalizedQuestion) return;
    setLoading(true);
    setError(undefined);
    setPendingTurn(beginPendingPortfolioAnalystTurn(normalizedQuestion));
    setQuestion("");
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const body: {
        mode: "agent";
        provider: PortfolioAnalystProviderId;
        defaultPeriod: Period;
        language: PortfolioAnalystLanguage;
        includeHoldingNames: boolean;
        question: string;
        screenshotCount?: number;
        conversationId?: string;
      } = {
        mode: "agent",
        provider,
        defaultPeriod: period,
        language,
        includeHoldingNames,
        question: normalizedQuestion,
        ...(screenshotCount ? { screenshotCount } : {}),
        ...(conversation ? { conversationId: conversation.id } : {}),
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
          if (!screenshotCount) setConversation(event.conversation);
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
          ? { ...current, answerText: "", phase: "failed" }
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
      setAccountOptions([]);
      setSelectedAccountId("");
      pendingImportRoute.current = undefined;
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
      setIncludeHoldingNames(settings.includeHoldingNames);
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

  return (
    <div
      className="portfolio-agent-shell"
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
              <h2 id="portfolio-analyst-title">Alligator</h2>
              <p>Your portfolio companion. Ask me anything or send a screenshot.</p>
            </div>
          </div>
        </header>

        <div className="portfolio-analyst-workspace">
        {!configuration && !error && <p className="portfolio-analyst-state">Checking provider configuration…</p>}
        {selectedProvider && !selectedProvider.configured && !error && (
          <p className="portfolio-analyst-state">
            Add {provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"} to .env.local, then restart the app.
          </p>
        )}
        <div ref={conversationView} className="analyst-conversation" aria-live="polite">
          {!conversation?.turns.length && !conversation?.importActivities.length && !pendingTurn && (
            <div className="analyst-conversation-empty">
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
          {conversation && [
            ...conversation.turns.map((turn) => ({ kind: "turn" as const, at: turn.createdAt, turn })),
            ...conversation.importActivities.map((activity) => ({ kind: "import" as const, at: activity.createdAt, activity })),
            ...conversation.importActivities.flatMap((activity) => (activity.followUps ?? []).map((followUp) => ({
              kind: "import-follow-up" as const, at: followUp.createdAt, followUp,
            }))),
          ].toSorted((left, right) => left.at.localeCompare(right.at)).map((entry) => entry.kind === "turn" ? (
            <div className="analyst-turn" key={entry.turn.id}>
              <div className="analyst-user-entry">
                {entry.turn.attachments?.length ? (
                  <AgentMessageImages attachments={entry.turn.attachments} />
                ) : null}
                {(entry.turn.userText ?? entry.turn.question) ? (
                  <div className="analyst-user-message"><p>{entry.turn.userText ?? entry.turn.question}</p></div>
                ) : null}
              </div>
              {entry.turn.report ? <AnalystReport
                report={entry.turn.report}
                actionStatus={accountActionStatus[entry.turn.id]}
                onConfirmCreateAccount={(action) => void confirmCreateAccount(entry.turn.id, action)}
                sourceId={entry.turn.id}
                sourcesOpen={selectedEvidenceId === entry.turn.id}
                onShowSources={() => {
                  setSelectedEvidenceId(entry.turn.id);
                  window.requestAnimationFrame(() => {
                    document.getElementById("agent-sources-panel")?.focus();
                    document.getElementById("agent-review")?.scrollIntoView({ block: "start", behavior: "smooth" });
                  });
                }}
              /> : entry.turn.imageAnswer ? <div className="analyst-primary-answer analyst-assistant-message" aria-live="polite">
                {entry.turn.imageAnswer.status === "pending" || entry.turn.imageAnswer.status === "failed" ? (
                  <div className="analyst-image-answer-status">
                    <p>{answeringImageTurnId === entry.turn.id
                      ? (streamedImageAnswer || "Thinking about your image…")
                      : entry.turn.imageAnswer.status === "failed"
                        ? "I couldn't finish reading this image."
                        : "Image sent. Response paused."}</p>
                    {answeringImageTurnId !== entry.turn.id && (
                      <button type="button" disabled={loading || importBusy} onClick={() => void retryImageQuestion(entry.turn.id)}>
                        Retry response
                      </button>
                    )}
                  </div>
                ) : <>
                  <AssistantMessageContent text={entry.turn.imageAnswer.text} />
                  {entry.turn.imageAnswer.uncertainties.length > 0 && (
                    <ul>{entry.turn.imageAnswer.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>
                  )}
                </>}
              </div> : null}
            </div>
          ) : entry.kind === "import-follow-up" ? (
            <div className="analyst-turn" key={entry.followUp.id}>
              <div className="analyst-user-message"><p>{entry.followUp.userText}</p></div>
              <div className="analyst-primary-answer analyst-assistant-message"><p>{entry.followUp.assistantText}</p></div>
            </div>
          ) : importDrafts[entry.activity.draftId] ? (
            <div className="analyst-import-chat-status" key={entry.activity.draftId}>
              <strong>{entry.activity.targetLabel}</strong>
              <span>{importDrafts[entry.activity.draftId].status === "confirmed"
                ? "Import confirmed · portfolio updated"
                : `${entry.activity.screenshotCount} screenshot${entry.activity.screenshotCount === 1 ? "" : "s"} analyzed · awaiting review`}</span>
              {entry.activity.draftId === activeReview?.draftId && !entry.activity.followUps?.length && activeDateRequest && <p>
                {importDateFollowUpQuestion(activeDateRequest, language)}
              </p>}
              {importDrafts[entry.activity.draftId].status === "draft" && (
                <button type="button" onClick={() => {
                  setSelectedEvidenceId(undefined);
                  setSelectedReviewId(entry.activity.draftId);
                  document.getElementById("agent-review")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }}>Review draft</button>
              )}
            </div>
          ) : null)}
          {pendingImageMessage && (
            <div className="analyst-turn pending" aria-live="polite">
              <div className="analyst-user-entry">
                <PendingAgentMessageImages files={pendingImageMessage.files} />
                {pendingImageMessage.text && <div className="analyst-user-message"><p>{pendingImageMessage.text}</p></div>}
                <small className="analyst-user-status">Sending…</small>
              </div>
            </div>
          )}
          {pendingImportReply && (
            <div className="analyst-turn pending" aria-live="polite">
              <div className="analyst-user-message"><p>{pendingImportReply}</p><small>Working…</small></div>
            </div>
          )}
          {pendingTurn && !pendingImageMessage && (
            <div className="analyst-turn pending">
              <div className="analyst-user-message">
                <p>{pendingTurn.question}</p>
              </div>
              <AgentActivityTimeline
                activities={pendingTurn.activities}
                language={language}
                phase={pendingTurn.phase}
                statusHistory={pendingTurn.statusHistory}
              />
              {pendingTurn.answerText ? (
                <div className={`analyst-streaming-message analyst-assistant-message ${pendingTurn.phase}`}>
                    <p>{pendingTurn.answerText}<i aria-hidden="true" /></p>
                    <small>{language === "zh-CN" ? "生成中 · 完成后验证证据" : "Generating · evidence is validated on completion"}</small>
                </div>
              ) : pendingTurn.phase === "failed" || pendingTurn.phase === "stopped" ? (
                <div className={`analyst-streaming-message analyst-assistant-message ${pendingTurn.phase}`}>
                  <p>{pendingPhaseLabel(pendingTurn.phase, language)}</p>
                  {pendingTurn.phase === "failed" && <button type="button" className="secondary"
                    onClick={retryFailedTurn} disabled={loading || importBusy}>
                    {language === "zh-CN" ? "重试" : "Try again"}
                  </button>}
                </div>
              ) : null}
            </div>
          )}
          {error && <div className="analyst-turn" role="alert">
            <div className="analyst-primary-answer analyst-assistant-message"><p>{error}</p></div>
          </div>}
        </div>
        <div className="analyst-composer">
          {importAttachments.files.length > 0 && accountOptions.length > 0 && (
            <label className="analyst-account-picker">
              {language === "zh-CN" ? "截图所属账户" : "Screenshot account"}
              <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
                <option value="">{language === "zh-CN" ? "请选择账户" : "Choose an account"}</option>
                {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
              </select>
            </label>
          )}
          <div className="analyst-composer-box">
            <textarea
              ref={composer}
              rows={2}
              maxLength={600}
              disabled={loading || importBusy || !selectedProvider?.configured}
              value={question}
              aria-label={language === "zh-CN" ? "给助手发送消息" : "Message your assistant"}
              placeholder={language === "zh-CN" ? "提出问题，或分享一张图片……" : "Ask a question or share an image…"}
              onChange={(event) => {
                pendingImportRoute.current = undefined;
                setQuestion(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitComposer();
                }
              }}
            />
            <div className="analyst-composer-bottom">
              <AgentImageAttachments
                state={importAttachments}
                language={language}
                onChange={(next) => {
                  pendingImportRoute.current = undefined;
                  setImportAttachments(next);
                  setAccountOptions([]);
                  setSelectedAccountId("");
                }}
              />
              <div className="analyst-composer-actions">
                {loading || importBusy ? (
                  <button type="button" className="secondary" disabled={Boolean(pendingImageMessage)} onClick={() => activeRequest.current?.abort()}>
                    {pendingImageMessage
                      ? (language === "zh-CN" ? "发送中…" : "Sending…")
                      : (language === "zh-CN" ? "停止" : "Stop")}
                  </button>
                ) : (
                  <button type="button" onClick={submitComposer}
                    disabled={!selectedProvider?.configured || (!question.trim() && importAttachments.files.length === 0)}>
                    {language === "zh-CN" ? "发送" : "Send"}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="analyst-composer-meta">
            <small>{language === "zh-CN" ? "仅供信息，不构成投资建议" : "Information only, not investment advice"}</small>
            {conversation && <button type="button" disabled={loading || importBusy} onClick={() => void resetConversation()}>
              {language === "zh-CN" ? "重置对话" : "Reset conversation"}
            </button>}
          </div>
        </div>
        </div>
      </aside>
      {reviewHost && selectedEvidenceTurn?.report && createPortal(
        <section id="agent-sources-panel" className="home-review-panel home-sources-panel" aria-label="Sources for the selected answer" tabIndex={-1}>
          <div className="home-review-panel-heading">
            <div>
              <p className="eyebrow">ANSWER SOURCES</p>
              <h2>Facts and sources</h2>
              <p className="home-sources-question">{selectedEvidenceTurn.userText ?? selectedEvidenceTurn.question}</p>
            </div>
            <button type="button" className="home-review-close" onClick={() => {
              const sourceButton = document.getElementById(`sources-${selectedEvidenceTurn.id}`);
              setSelectedEvidenceId(undefined);
              window.requestAnimationFrame(() => sourceButton?.focus());
            }} aria-label="Close sources">×</button>
          </div>
          <div className="home-review-scroll">
            <AnalystReport report={selectedEvidenceTurn.report} sourcesOnly />
          </div>
        </section>,
        reviewHost,
      )}
      {reviewHost && !selectedEvidenceTurn && activeReview && activeDraft && createPortal(
        <section className="home-review-panel" aria-label={`Review ${activeReview.targetLabel} import`}>
          <div className="home-review-panel-heading">
            <div><p className="eyebrow">IMPORT REVIEW</p><h2>Review {activeReview.targetLabel}</h2></div>
            <span>Changes apply after confirmation</span>
          </div>
          <div className="home-review-scroll">
            <AgentImportDraftReview
              draft={activeDraft}
              targetLabel={activeReview.targetLabel}
              language={language}
              busy={importBusy}
              saveStatus={saveStatus[activeReview.draftId]}
              onEdit={(edit) => editImportDraft(activeReview.draftId, edit)}
              onAddHolding={() => addImportHolding(activeReview.draftId)}
              onConfirm={() => void confirmAccountImport(activeReview.draftId)}
            />
          </div>
        </section>,
        reviewHost,
      )}
    </div>
  );
}

function AgentMessageImages({ attachments }: { attachments: PortfolioAnalystImageAttachment[] }) {
  return <AgentImageCards images={attachments.map((attachment, index) => ({
    key: attachment.id,
    url: `/api/portfolio/analyst/images/${encodeURIComponent(attachment.id)}`,
    label: `Screenshot ${index + 1}`,
  }))} />;
}

function PendingAgentMessageImages({ files }: { files: readonly File[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((file) => URL.createObjectURL(file));
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  return <AgentImageCards images={urls.map((url, index) => ({
    key: url, url, label: files[index]?.name || `Screenshot ${index + 1}`,
  }))} />;
}

function AgentImageCards({ images }: { images: readonly { key: string; url: string; label: string }[] }) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const activeImage = activeIndex === undefined ? undefined : images[activeIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (activeImage && !dialog.open) dialog.showModal();
    if (!activeImage && dialog.open) dialog.close();
  }, [activeImage]);

  if (images.length === 0) return null;
  return <>
    <div className="analyst-message-images" aria-label="Attached screenshots">
      {images.map((image, index) => <button
        key={image.key}
        className="analyst-image-card"
        type="button"
        aria-label={`Preview ${image.label}`}
        onClick={(event) => {
          openerRef.current = event.currentTarget;
          setActiveIndex(index);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- these images come from local URLs or the private image route */}
        <img src={image.url} alt="" loading="lazy" />
      </button>)}
    </div>
    <dialog
      ref={dialogRef}
      className="analyst-image-preview"
      aria-label="Screenshot preview"
      onClose={() => {
        setActiveIndex(undefined);
        openerRef.current?.focus();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setActiveIndex(undefined);
      }}
    >
      {activeImage && <div className="analyst-image-preview-content">
        <button type="button" className="analyst-image-preview-close"
          onClick={() => setActiveIndex(undefined)} aria-label="Close screenshot preview">×</button>
          {/* eslint-disable-next-line @next/next/no-img-element -- the preview uses the same private image URL as its thumbnail */}
          <img src={activeImage.url} alt={activeImage.label} />
        {images.length > 1 && <div className="analyst-image-preview-nav">
          <button type="button" disabled={activeIndex === 0} onClick={() => setActiveIndex(activeIndex! - 1)}>← Previous</button>
          <button type="button" disabled={activeIndex === images.length - 1} onClick={() => setActiveIndex(activeIndex! + 1)}>Next →</button>
        </div>}
      </div>}
    </dialog>
  </>;
}

function pendingPhaseLabel(
  phase: PendingPortfolioAnalystTurn["phase"],
  language: PortfolioAnalystLanguage,
) {
  const labels = language === "zh-CN" ? {
    sending: "正在连接……",
    "selecting-tool": "正在选择合适的只读工具……",
    "reading-current-facts": "正在读取当前本地事实……",
    "generating-answer": "正在生成回答……",
    stopped: "已停止。",
    failed: "抱歉，这次回答失败了。你的消息还在，可以点“重试”再试一次。",
  } : {
    sending: "Connecting…",
    "selecting-tool": "Choosing a read-only tool…",
    "reading-current-facts": "Reading current local facts…",
    "generating-answer": "Generating an answer…",
    stopped: "Stopped.",
    failed: "Sorry, I couldn't finish that reply. Your message is still here; please try again.",
  };
  return labels[phase];
}

function analystToolLabel(
  name: PortfolioAnalystToolName,
  language: PortfolioAnalystLanguage,
) {
  const labels = language === "zh-CN" ? {
    read_period_drivers: "期间表现",
    read_data_quality: "数据质量",
    read_portfolio_overview: "组合概览",
    read_accounts: "账户列表",
    read_account_holdings: "账户持仓",
    propose_create_account: "账户创建提议",
    prepare_account_import: "资产导入准备",
  } : {
    read_period_drivers: "period performance",
    read_data_quality: "data quality",
    read_portfolio_overview: "portfolio overview",
    read_accounts: "source accounts",
    read_account_holdings: "account holdings",
    propose_create_account: "account creation proposal",
    prepare_account_import: "asset import preparation",
  };
  return labels[name];
}

function analystToolScope(
  name: PortfolioAnalystToolName,
  input: { period?: "today" | "week" | "month"; accountType?: string; label?: string },
  language: PortfolioAnalystLanguage,
) {
  if (name !== "read_period_drivers" || !input.period) return analystToolLabel(name, language);
  const periods = language === "zh-CN"
    ? { today: "今日", week: "7 天", month: "30 天" }
    : { today: "today's", week: "7-day", month: "30-day" };
  return `${periods[input.period]}${language === "zh-CN" ? "" : " "}${analystToolLabel(name, language)}`;
}

export function AgentActivityTimeline({
  activities,
  audit,
  language,
  phase,
}: {
  activities?: PortfolioAnalystToolActivity[];
  audit?: PortfolioAnalystAgentAudit;
  language: PortfolioAnalystLanguage;
  phase: PendingPortfolioAnalystTurn["phase"] | "completed";
  statusHistory?: PendingPortfolioAnalystTurn["statusHistory"];
}) {
  const streamedActivities = activities ?? [];
  const latestStreamedCalls = Array.from(streamedActivities.reduce((calls, activity) => {
    calls.set(activity.toolCallId, activity);
    return calls;
  }, new Map<string, PortfolioAnalystToolActivity>()).values());
  const interrupted = phase === "failed" || phase === "stopped";
  const calls = audit?.toolCalls ?? latestStreamedCalls;
  if (calls.length === 0) return null;
  return (
    <ol className="analyst-agent-activity" aria-label={language === "zh-CN" ? "数据读取" : "Data checks"}>
      {audit
        ? audit.toolCalls.map((call) => (
            <li className={call.status === "completed" ? "done" : call.status} key={call.toolCallId}>
              <i aria-hidden="true" />{call.status === "completed"
                ? (language === "zh-CN"
                    ? `已读取 ${analystToolScope(call.name, call.input, language)} · ${call.evidenceKeys.length} 条当前事实`
                    : `Read ${analystToolScope(call.name, call.input, language)} · ${call.evidenceKeys.length} current facts`)
                : call.status === "blocked"
                  ? (language === "zh-CN" ? `已停止额外读取：${analystToolScope(call.name, call.input, language)}` : `Stopped extra read: ${analystToolScope(call.name, call.input, language)}`)
                  : (language === "zh-CN" ? `读取失败：${analystToolScope(call.name, call.input, language)}` : `Failed to read ${analystToolScope(call.name, call.input, language)}`)}
            </li>
          ))
        : latestStreamedCalls.map((activity) => (
            <li
              className={activity.stage === "completed" ? "done" : interrupted ? "failed" : "active"}
              key={activity.toolCallId}
            >
              <i aria-hidden="true" />{activity.stage === "started"
                ? (language === "zh-CN"
                    ? `正在读取 ${analystToolScope(activity.name, activity.input, language)}……`
                    : `Reading ${analystToolScope(activity.name, activity.input, language)}…`)
                : (language === "zh-CN"
                    ? `已读取 ${analystToolScope(activity.name, activity.input, language)} · ${activity.evidenceCount} 条当前事实`
                    : `Read ${analystToolScope(activity.name, activity.input, language)} · ${activity.evidenceCount} current facts`)}
            </li>
          ))}
    </ol>
  );
}

export function AnalystReport({
  report,
  actionStatus,
  onConfirmCreateAccount,
  sourceId,
  sourcesOpen,
  onShowSources,
  sourcesOnly = false,
}: {
  report: PortfolioAnalystReport;
  actionStatus?: "confirming" | "created" | "failed";
  onConfirmCreateAccount?: (
    action: Extract<FactualUpdate, { kind: "create-account" }>,
  ) => void;
  sourceId?: string;
  sourcesOpen?: boolean;
  onShowSources?: () => void;
  sourcesOnly?: boolean;
}) {
  const language = report.language;
  const evidence = new Map(report.evidence.map((fact) => [fact.key, fact]));
  const answer = report.answer;
  const completedToolCount = report.agentAudit?.toolCalls.filter((call) => call.status === "completed").length ?? 0;
  const periodLabel = report.scope.period
    ? (language === "zh-CN"
        ? { today: "今日", week: "7 天", month: "30 天" }[report.scope.period]
        : { today: "Today", week: "7 days", month: "30 days" }[report.scope.period])
    : undefined;
  const reportKind = completedToolCount > 1
    ? (language === "zh-CN" ? "组合分析" : "Combined portfolio analysis")
    : report.job === "explain-period-drivers"
      ? `${language === "zh-CN" ? "期间表现" : "Performance drivers"} · ${periodLabel ?? (language === "zh-CN" ? "所选期间" : "Selected period")}`
      : report.job === "summarize-portfolio"
        ? (language === "zh-CN" ? "组合概览" : "Portfolio overview")
        : report.job === "manage-accounts"
          ? (language === "zh-CN" ? "账户管理" : "Account management")
          : (language === "zh-CN" ? "数据质量诊断" : "Data quality diagnosis");
  return (
    <article className={`portfolio-analyst-result${sourcesOnly ? " sources-only" : ""}`} aria-live={sourcesOnly ? undefined : "polite"}>
      {!sourcesOnly && <>
      <div className="analyst-primary-answer analyst-assistant-message">
        <AssistantMessageContent text={answer.answer.text} />
      </div>
      {answer.limitations.length > 0 && (
        <div className="analyst-visible-caveats">
          <strong>{language === "zh-CN" ? "请注意" : "Worth checking"}</strong>
          <ul>
            {answer.limitations.slice(0, 2).map((limitation) => (
              <li key={analystLimitationKey(limitation)}>
                {portfolioAnalystLimitationLabel(limitation.code, language)}
              </li>
            ))}
          </ul>
          {answer.limitations.length > 2 && <small>
            {language === "zh-CN" ? "更多限制见下方依据" : "More limitations in sources and details"}
          </small>}
        </div>
      )}
      {answer.proposedUpdate?.kind === "create-account" && (
        <section className="analyst-account-confirmation">
          <span>{language === "zh-CN" ? "需要你的确认" : "Your confirmation is required"}</span>
          <strong>{portfolioAnalystActionLabel(answer.proposedUpdate, language)}</strong>
          <p>{language === "zh-CN"
            ? "确认后才会写入本地账户注册表；随后可进入 Import 添加资产。"
            : "The local account registry changes only after confirmation. You can then import its assets."}</p>
          {actionStatus === "created" ? (
            <div className="analyst-account-confirmed">
              <span>{language === "zh-CN" ? "账户已创建" : "Account created"}</span>
              <Link href="/accounts">{language === "zh-CN" ? "查看账户" : "View accounts"}</Link>
            </div>
          ) : (
            <button
              type="button"
              disabled={!onConfirmCreateAccount || actionStatus === "confirming"}
              onClick={() => onConfirmCreateAccount?.(answer.proposedUpdate as Extract<FactualUpdate, { kind: "create-account" }>)}
            >
              {actionStatus === "confirming"
                ? (language === "zh-CN" ? "正在创建……" : "Creating…")
                : actionStatus === "failed"
                  ? (language === "zh-CN" ? "重试创建" : "Try again")
                  : (language === "zh-CN" ? "确认创建账户" : "Confirm account creation")}
            </button>
          )}
        </section>
      )}
      </>}
      {sourcesOnly && <div className="analyst-facts-evidence">
        <div className="analyst-facts-evidence-body">
          {report.agentAudit && (
            <AgentActivityTimeline audit={report.agentAudit} language={language} phase="completed" />
          )}
          {answer.claims.length > 0 && (
            <section className="analyst-supporting-facts">
              <h4>{language === "zh-CN" ? "补充事实" : "Supporting facts"}</h4>
              <ul className="analyst-claims">
                {answer.claims.map((claim, index) => (
                  <li key={`${index}:${claim.text}`}>
                    <Classification value={claim.classification} />
                    <p>{claim.text}</p>
                    <EvidenceKeys keys={claim.evidence} facts={evidence} language={language} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {answer.limitations.length > 0 && (
            <section className="analyst-limitations">
              <strong>{language === "zh-CN" ? "限制的依据" : "Limitation evidence"}</strong>
              <ul>{answer.limitations.map((limitation) => (
                <li key={analystLimitationKey(limitation)}>
                  {portfolioAnalystLimitationLabel(limitation.code, language)}
                  <EvidenceKeys keys={[limitation.evidenceKey]} facts={evidence} language={language} />
                </li>
              ))}</ul>
            </section>
          )}
          {answer.proposedUpdate && (
            <section className="analyst-proposed-update">
              <span>{language === "zh-CN" ? "建议的事实更新（未执行）" : "Suggested factual update (not executed)"}</span>
              <strong>{portfolioAnalystActionLabel(answer.proposedUpdate, language)}</strong>
              <EvidenceKeys keys={[answer.proposedUpdate.reasonEvidenceKey]} facts={evidence} language={language} />
            </section>
          )}
          <section className="portfolio-analyst-evidence">
            <h4>{language === "zh-CN" ? "回答依据" : "Answer evidence"}</h4>
            <div className="analyst-answer-basis">
              <Classification value={answer.answer.classification} />
              <EvidenceKeys keys={answer.answer.evidence} facts={evidence} language={language} />
            </div>
            <dl>
              {report.evidence.map((fact) => (
                <div key={fact.key} id={`analyst-fact-${fact.key}`}>
                  <dt>{fact.label}<small>{fact.key} · {fact.provenance}</small></dt>
                  <dd>{portfolioAnalystEvidenceValue(fact, language)}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="analyst-report-metadata">
            <h4>{language === "zh-CN" ? "回答信息" : "Answer details"}</h4>
            <dl>
              <div><dt>{language === "zh-CN" ? "范围" : "Scope"}</dt><dd>{reportKind}</dd></div>
              {report.factsAsOf !== report.generatedAt && <div><dt>{language === "zh-CN" ? "分析快照" : "Analysis snapshot"}</dt><dd>{new Date(report.factsAsOf).toLocaleString()}</dd></div>}
              <div><dt>{language === "zh-CN" ? "生成时间" : "Generated"}</dt><dd>{new Date(report.generatedAt).toLocaleString()}</dd></div>
              <div><dt>{language === "zh-CN" ? "模型" : "Model"}</dt><dd>{providerNames[report.provider]} · {report.model}</dd></div>
            </dl>
          </section>
        </div>
      </div>}
      {!sourcesOnly && onShowSources && <button
        type="button"
        className="analyst-sources-button"
        onClick={onShowSources}
        id={sourceId ? `sources-${sourceId}` : undefined}
        aria-controls="agent-review"
        aria-expanded={sourcesOpen}
        aria-label={language === "zh-CN" ? "在右侧查看这条回答的来源" : "Show sources for this answer on the right"}
      >{language === "zh-CN" ? "来源" : "Sources"}{report.evidence.length > 0 && <span>{report.evidence.length}</span>}</button>}
      {!sourcesOnly && <small className="analyst-disclaimer">
        <time dateTime={report.generatedAt}>{new Intl.DateTimeFormat(
          language === "zh-CN" ? "zh-CN" : "en-FI",
          { hour: "2-digit", minute: "2-digit" },
        ).format(new Date(report.generatedAt))}</time>
      </small>}
    </article>
  );
}


export function analystLimitationKey(
  limitation: PortfolioAnalystAnswer["limitations"][number],
): string {
  return `${limitation.code}:${limitation.evidenceKey}`;
}

function Classification({
  value,
}: {
  value: PortfolioAnalystAnswer["answer"]["classification"];
}) {
  return <span className={`analyst-classification ${value}`}>{classificationLabels[value]}</span>;
}

function EvidenceKeys({
  keys,
  facts,
  language,
}: {
  keys: string[];
  facts: Map<string, AnalystEvidenceFact>;
  language: PortfolioAnalystLanguage;
}) {
  const labels = [...new Set(keys.map((key) => facts.get(key)?.label ?? key))];
  return (
    <small className="analyst-evidence-keys">
      {language === "zh-CN" ? "依据：" : "Based on: "}{labels.join(" · ")}
    </small>
  );
}
