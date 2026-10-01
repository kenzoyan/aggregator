"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  PortfolioAnalystAgentAudit,
  PortfolioAnalystToolActivity,
  PortfolioAnalystToolName,
} from "@/application/portfolio-analyst-agent";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
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

export function PortfolioAnalyst({ blocked = false }: { blocked?: boolean }) {
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const conversationView = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const entryAction = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [configuration, setConfiguration] = useState<AnalystConfiguration>();
  const [provider, setProvider] = useState<PortfolioAnalystProviderId>("openai");
  const [period, setPeriod] = useState<Period>("week");
  const [language, setLanguage] = useState<PortfolioAnalystLanguage>("zh-CN");
  const [includeHoldingNames, setIncludeHoldingNames] = useState(true);
  const [conversation, setConversation] = useState<PortfolioAnalystConversation>();
  const [pendingTurn, setPendingTurn] = useState<PendingPortfolioAnalystTurn>();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importOperation, setImportOperation] = useState<"analysis" | "confirmation">("analysis");
  const [error, setError] = useState<string>();
  const [importTarget, setImportTarget] = useState<StartAccountImportAction>();
  const [accountOptions, setAccountOptions] = useState<AgentImportAccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [importAttachments, setImportAttachments] = useState<AgentImageAttachmentState<File>>(
    () => createAgentImageAttachmentState<File>(),
  );
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
  }, [conversation?.turns.length, Object.keys(importDrafts).length, pendingTurn?.answerText]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen((current) => {
        if (!current) return current;
        window.requestAnimationFrame(() => entryAction.current?.focus());
        return false;
      });
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      activeRequest.current?.abort();
    };
  }, []);

  function openAgent() {
    setOpen(true);
    window.requestAnimationFrame(() => composer.current?.focus());
  }

  function closeAgent() {
    setOpen(false);
    window.requestAnimationFrame(() => entryAction.current?.focus());
  }

  function startPrompt(prompt: string) {
    setOpen(true);
    void runAnalyst(prompt);
  }

  function startAccountImport(action: StartAccountImportAction) {
    if (loading || importBusy) return;
    setImportTarget(action);
    setImportAttachments((current) => resetAgentImageAttachments(current));
    setSelectedAccountId("");
    setError(undefined);
    window.requestAnimationFrame(() => composer.current?.focus());
  }

  function cancelAccountImport() {
    if (importBusy) return;
    setImportTarget(undefined);
    setImportAttachments((current) => resetAgentImageAttachments(current));
    setSelectedAccountId("");
    setError(undefined);
  }

  async function analyzeAccountImport(
    submission: NonNullable<ReturnType<typeof createAgentComposerSubmission<File>>>,
    target: StartAccountImportAction | undefined,
    currentConversation: PortfolioAnalystConversation,
    chosenAccountId = "",
  ) {
    if (submission.screenshots.length === 0 || importBusy) return;
    setImportBusy(true);
    setImportOperation("analysis");
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
      setImportTarget(undefined);
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
      void submitScreenshotImport(submission);
      return;
    }
    void runAnalyst(submission.text);
  }

  async function submitScreenshotImport(
    submission: NonNullable<ReturnType<typeof createAgentComposerSubmission<File>>>,
  ) {
    setImportAttachments((current) => lockAgentImageAttachments(current));
    const prompt = submission.text || (language === "zh-CN"
      ? "请帮我识别截图中的资产，并准备导入已登记的账户。"
      : "Identify the assets in my screenshots and prepare an import into a registered account.");
    const routed = pendingImportRoute.current ?? await runAnalyst(prompt, submission.screenshots.length);
    if (!routed) {
      setQuestion(submission.text);
      setImportAttachments((current) => unlockAgentImageAttachments(current));
      return;
    }
    pendingImportRoute.current = routed;
    const proposed = routed.turns.at(-1)?.report.answer.proposedUpdate;
    const target = proposed?.kind === "start-account-import" ? proposed : importTarget;
    await analyzeAccountImport(submission, target, routed, selectedAccountId);
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

  function editImportDraft(draftId: string, edit: ImportDraftEdit) {
    const current = importDraftsRef.current[draftId];
    if (!current) return;
    const next = applyImportDraftEdit(current, edit);
    importDraftsRef.current = { ...importDraftsRef.current, [draftId]: next };
    setImportDrafts(importDraftsRef.current);
    void queueDraftSave(next);
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
    setImportOperation("confirmation");
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
      setImportTarget(undefined);
      pendingImportRoute.current = undefined;
      setImportAttachments((current) => resetAgentImageAttachments(current));
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
      let streamError: string | undefined;
      let streamFinished = false;
      let completedConversation: PortfolioAnalystConversation | undefined;
      await consumePortfolioAnalystStream(response, (event) => {
        if (event.type === "completed") {
          streamFinished = true;
          completedConversation = event.conversation;
          setConversation(event.conversation);
          setPendingTurn(undefined);
          return;
        }
        if (event.type === "failed") {
          streamFinished = true;
          streamError = event.error;
        }
        setPendingTurn((current) => current
          ? applyPortfolioAnalystStreamEvent(current, event)
          : current);
      });
      if (streamError) setError(streamError);
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
        setError(cause instanceof Error ? cause.message : "The analyst could not complete this job.");
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
      setPendingTurn(undefined);
      setQuestion("");
      setImportTarget(undefined);
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

  return (
    <div
      className={`portfolio-agent-shell${open ? " open" : ""}`}
      aria-hidden={blocked || undefined}
      inert={blocked || undefined}
    >
      <section className="portfolio-agent-home" id="agent" aria-labelledby="portfolio-agent-home-title">
        <header>
          <div className="portfolio-agent-home-title">
            <span aria-hidden="true">✦</span>
            <div>
              <p className="eyebrow">PORTFOLIO AGENT</p>
              <h2 id="portfolio-agent-home-title">Ask your portfolio</h2>
              <small>Read-only answers from current portfolio facts.</small>
            </div>
          </div>
          <button
            ref={entryAction}
            type="button"
            className="portfolio-agent-home-action"
            aria-controls="portfolio-analyst-panel"
            aria-expanded={open}
            onClick={openAgent}
          >
            {conversation?.turns.length
              ? `Continue chat · ${conversation.turns.length}`
              : "Start chat"}
          </button>
        </header>
        <div className="portfolio-agent-home-prompts">
          {starterQuestions[language].map((prompt) => (
            <button
              type="button"
              key={prompt}
              disabled={loading || !selectedProvider?.configured}
              onClick={() => startPrompt(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      </section>
      {open && <aside
        id="portfolio-analyst-panel"
        className="portfolio-analyst"
        aria-labelledby="portfolio-analyst-title"
      >
        <header className="portfolio-agent-header">
          <div className="portfolio-agent-identity">
            <span aria-hidden="true">✦</span>
            <div>
              <h2 id="portfolio-analyst-title">Portfolio Agent</h2>
              <p>Read-only · fresh facts every turn</p>
            </div>
          </div>
        <button
          type="button"
          aria-label="Close Portfolio Agent"
          onClick={closeAgent}
        >
          ×
        </button>
        </header>

        <div className="portfolio-analyst-workspace">
        {!configuration && !error && <p className="portfolio-analyst-state">Checking provider configuration…</p>}
        {selectedProvider && !selectedProvider.configured && !error && (
          <p className="portfolio-analyst-state">
            Add {provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"} to .env.local, then restart the app.
          </p>
        )}
        {error && <p className="portfolio-analyst-error" role="alert">{error}</p>}
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
          ].toSorted((left, right) => left.at.localeCompare(right.at)).map((entry) => entry.kind === "turn" ? (
            <div className="analyst-turn" key={entry.turn.id}>
              <div className="analyst-user-message">
                <span>You</span>
                <p>{entry.turn.question}</p>
              </div>
              <AnalystReport
                report={entry.turn.report}
                actionStatus={accountActionStatus[entry.turn.id]}
                onConfirmCreateAccount={(action) => void confirmCreateAccount(entry.turn.id, action)}
                onStartAccountImport={startAccountImport}
              />
            </div>
          ) : importDrafts[entry.activity.draftId] ? (
            <AgentImportDraftReview
              key={entry.activity.draftId}
              draft={importDrafts[entry.activity.draftId]}
              targetLabel={entry.activity.targetLabel}
              screenshotCount={entry.activity.screenshotCount}
              submissionText={entry.activity.submissionText}
              language={language}
              busy={importBusy}
              saveStatus={saveStatus[entry.activity.draftId]}
              onEdit={(edit) => editImportDraft(entry.activity.draftId, edit)}
              onAddHolding={() => addImportHolding(entry.activity.draftId)}
              onConfirm={() => void confirmAccountImport(entry.activity.draftId)}
            />
          ) : null)}
          {pendingTurn && (
            <div className="analyst-turn pending">
              <div className="analyst-user-message">
                <span>You</span>
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
                  <span>Portfolio Agent</span>
                    <p>{pendingTurn.answerText}<i aria-hidden="true" /></p>
                    <small>{language === "zh-CN" ? "生成中 · 完成后验证证据" : "Generating · evidence is validated on completion"}</small>
                </div>
              ) : pendingTurn.phase === "failed" || pendingTurn.phase === "stopped" ? (
                <div className={`analyst-streaming-message analyst-assistant-message ${pendingTurn.phase}`}>
                  <span>Portfolio Agent</span>
                  <p>{pendingPhaseLabel(pendingTurn.phase, language)}</p>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="analyst-composer">
          {importTarget && <div className="analyst-import-target" role="status">
            <span>{language === "zh-CN" ? `目标账户：${importTarget.label}` : `Account: ${importTarget.label}`}</span>
            <button type="button" disabled={importBusy} onClick={cancelAccountImport}>×</button>
          </div>}
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
          {importAttachments.files.length > 0 && accountOptions.length > 0 && (
            <label className="analyst-account-picker">
              {language === "zh-CN" ? "截图所属账户" : "Screenshot account"}
              <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
                <option value="">{language === "zh-CN" ? "请选择账户" : "Choose an account"}</option>
                {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
              </select>
            </label>
          )}
          <textarea
            ref={composer}
            rows={3}
            maxLength={600}
            disabled={loading || importBusy || !selectedProvider?.configured}
            value={question}
            placeholder={language === "zh-CN" ? "提问，或附上截图让我识别资产……" : "Ask a question or attach screenshots to import assets…"}
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
          <div className="analyst-composer-actions">
            <small>
              {language === "zh-CN"
                ? "仅供信息，不构成投资建议 · 发送当前有界事实及最多 3 轮本地对话。"
                : "Information only, not investment advice · Sends current bounded facts and up to 3 local turns."}
            </small>
            {conversation && (
              <button type="button" className="secondary" disabled={loading || importBusy} onClick={() => void resetConversation()}>
                {language === "zh-CN" ? "重置并删除" : "Reset & delete"}
              </button>
            )}
            {loading || importBusy ? (
              <button type="button" onClick={() => activeRequest.current?.abort()}>
                {importBusy
                  ? importOperation === "confirmation"
                    ? (language === "zh-CN" ? "停止确认" : "Stop confirmation")
                    : (language === "zh-CN" ? "停止识别" : "Stop analysis")
                  : (language === "zh-CN" ? "停止" : "Stop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={submitComposer}
                disabled={!selectedProvider?.configured || (!question.trim() && importAttachments.files.length === 0)}
              >
                {importAttachments.files.length > 0
                  ? (language === "zh-CN" ? "发送并识别" : "Send & analyze")
                  : (language === "zh-CN" ? "发送" : "Send")}
              </button>
            )}
          </div>
        </div>
        </div>
      </aside>}
    </div>
  );
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
    failed: "这次回答没有完成。",
  } : {
    sending: "Connecting…",
    "selecting-tool": "Choosing a read-only tool…",
    "reading-current-facts": "Reading current local facts…",
    "generating-answer": "Generating an answer…",
    stopped: "Stopped.",
    failed: "This answer did not complete.",
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
    <ol className="analyst-agent-activity" aria-label={language === "zh-CN" ? "Agent 活动" : "Agent activity"}>
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
  onStartAccountImport,
}: {
  report: PortfolioAnalystReport;
  actionStatus?: "confirming" | "created" | "failed";
  onConfirmCreateAccount?: (
    action: Extract<FactualUpdate, { kind: "create-account" }>,
  ) => void;
  onStartAccountImport?: (action: StartAccountImportAction) => void;
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
    <article className="portfolio-analyst-result" aria-live="polite">
      {report.agentAudit && (
        <AgentActivityTimeline audit={report.agentAudit} language={language} phase="completed" />
      )}
      <div className="analyst-primary-answer analyst-assistant-message">
        <span>Portfolio Agent</span>
        <p>{answer.answer.text}</p>
      </div>
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
      {answer.proposedUpdate?.kind === "start-account-import" && (
        <section className="analyst-account-confirmation analyst-import-handoff">
          <span>{language === "zh-CN" ? "可以在对话中继续" : "Continue in this conversation"}</span>
          <strong>{portfolioAnalystActionLabel(answer.proposedUpdate, language)}</strong>
          <p>{language === "zh-CN"
            ? "账户已由本地注册表验证。发送截图后会先生成草稿；确认前不会更新持仓。"
            : "The account was verified locally. Screenshots create a draft first; holdings do not change before confirmation."}</p>
          <div className="analyst-import-actions">
            {onStartAccountImport && (
              <button
                type="button"
                onClick={() => onStartAccountImport(answer.proposedUpdate as StartAccountImportAction)}
              >
                {language === "zh-CN" ? "在这里发送截图" : "Send screenshots here"}
              </button>
            )}
            <Link href={`/imports?accountType=${encodeURIComponent(answer.proposedUpdate.accountType)}`}>
              {language === "zh-CN" ? "改用 Import 页面" : "Use Import page instead"}
            </Link>
          </div>
        </section>
      )}
      <details className="analyst-facts-evidence">
        <summary>
          <span>{language === "zh-CN" ? "事实与依据" : "Facts & evidence"}</span>
          <small>
            {answer.claims.length > 0
              ? `${answer.claims.length} ${language === "zh-CN" ? "条补充事实" : "claims"} · `
              : ""}
            {language === "zh-CN" ? `${report.evidence.length} 条依据` : `${report.evidence.length} evidence facts`}
          </small>
        </summary>
        <div className="analyst-facts-evidence-body">
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
              <strong>{language === "zh-CN" ? "已知限制" : "Known limitations"}</strong>
              <ul>
                {answer.limitations.map((limitation) => (
                  <li key={analystLimitationKey(limitation)}>
                    {portfolioAnalystLimitationLabel(limitation.code, language)}
                    <EvidenceKeys keys={[limitation.evidenceKey]} facts={evidence} language={language} />
                  </li>
                ))}
              </ul>
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
      </details>
      <small className="analyst-disclaimer">
        <time dateTime={report.generatedAt}>{new Intl.DateTimeFormat(
          language === "zh-CN" ? "zh-CN" : "en-FI",
          { hour: "2-digit", minute: "2-digit" },
        ).format(new Date(report.generatedAt))}</time>
        <span>{language === "zh-CN" ? "基于本地事实" : "Based on local facts"}</span>
      </small>
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
