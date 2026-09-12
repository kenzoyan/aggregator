"use client";

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
  PortfolioAnalystLanguage,
} from "@/application/portfolio-analyst-context";
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
}

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
  ],
  en: [
    "How is my portfolio performing today?",
    "Which holdings affected my portfolio most over the last 7 days?",
    "Which portfolio data needs updating?",
  ],
} as const;

export function PortfolioAnalyst() {
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const conversationView = useRef<HTMLDivElement | null>(null);
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
  const [error, setError] = useState<string>();
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
  }, [conversation?.turns.length, pendingTurn?.answerText]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      activeRequest.current?.abort();
    };
  }, []);

  async function runAnalyst(requestedQuestion?: string) {
    const normalizedQuestion = (requestedQuestion ?? question).trim();
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
        conversationId?: string;
      } = {
        mode: "agent",
        provider,
        defaultPeriod: period,
        language,
        includeHoldingNames,
        question: normalizedQuestion,
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
      await consumePortfolioAnalystStream(response, (event) => {
        if (event.type === "completed") {
          streamFinished = true;
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
    if (loading) return;
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

  return (
    <div className={`portfolio-agent-shell${open ? " open" : ""}`}>
      {!open && (
        <button
          type="button"
          className="portfolio-agent-launcher"
          aria-label="Open Portfolio Agent"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">✦</span>
          <strong>Agent</strong>
          {conversation?.turns.length ? <small>{conversation.turns.length}</small> : null}
        </button>
      )}
      {open && <aside
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
          <button type="button" aria-label="Close Portfolio Agent" onClick={() => setOpen(false)}>×</button>
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
          {!conversation?.turns.length && !pendingTurn && (
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
          {conversation?.turns.map((turn) => (
            <div className="analyst-turn" key={turn.id}>
              <div className="analyst-user-message">
                <span>You</span>
                <p>{turn.question}</p>
              </div>
              <AnalystReport report={turn.report} />
            </div>
          ))}
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
          <textarea
            rows={3}
            maxLength={600}
            disabled={loading || !selectedProvider?.configured}
            value={question}
            placeholder={language === "zh-CN" ? "继续追问这次分析……" : "Ask a follow-up about this analysis…"}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void runAnalyst();
              }
            }}
          />
          <div className="analyst-composer-actions">
            <small>
              {language === "zh-CN"
                ? "发送当前有界事实及最多 3 轮本地对话；不会发送截图、凭据、数量或成本基础。"
                : "Sends current bounded facts and up to 3 local turns; never screenshots, credentials, quantities or cost basis."}
            </small>
            {conversation && (
              <button type="button" className="secondary" disabled={loading} onClick={() => void resetConversation()}>
                {language === "zh-CN" ? "重置并删除" : "Reset & delete"}
              </button>
            )}
            {loading ? (
              <button type="button" onClick={() => activeRequest.current?.abort()}>
                {language === "zh-CN" ? "停止" : "Stop"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runAnalyst()}
                disabled={!selectedProvider?.configured || !question.trim()}
              >
                {language === "zh-CN" ? "发送" : "Send"}
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
  return name === "read_period_drivers"
    ? (language === "zh-CN" ? "期间表现" : "Period drivers")
    : (language === "zh-CN" ? "数据质量" : "Data quality");
}

export function AgentActivityTimeline({
  activities,
  audit,
  language,
  phase,
  statusHistory = [],
}: {
  activities?: PortfolioAnalystToolActivity[];
  audit?: PortfolioAnalystAgentAudit;
  language: PortfolioAnalystLanguage;
  phase: PendingPortfolioAnalystTurn["phase"] | "completed";
  statusHistory?: PendingPortfolioAnalystTurn["statusHistory"];
}) {
  const streamedActivities = activities ?? [];
  const completedStreamedCalls = new Set(streamedActivities
    .filter((activity) => activity.stage === "completed")
    .map((activity) => activity.toolCallId));
  const isWaiting = phase === "sending";
  const interrupted = phase === "failed" || phase === "stopped";
  const showSelection = Boolean(audit) || [
    "selecting-tool",
    "reading-current-facts",
    "generating-answer",
    "completed",
  ].includes(phase) || statusHistory.includes("selecting-tool");
  const selectionCompleted = Boolean(audit) || streamedActivities.length > 0 || [
    "reading-current-facts",
    "generating-answer",
    "completed",
  ].includes(phase) || statusHistory.some((item) => item !== "selecting-tool");
  const showGeneration = phase === "generating-answer" || phase === "completed" ||
    statusHistory.includes("generating-answer");
  if (interrupted && !showSelection && streamedActivities.length === 0) return null;
  return (
    <ol className="analyst-agent-activity" aria-label={language === "zh-CN" ? "Agent 活动" : "Agent activity"}>
      {isWaiting && <li className="active"><i aria-hidden="true" />{language === "zh-CN" ? "连接 Agent" : "Connecting to Agent"}</li>}
      {showSelection && <li className={selectionCompleted ? "done" : interrupted ? "failed" : "active"}>
        <i aria-hidden="true" />{language === "zh-CN" ? "选择合适的只读工具" : "Choose a read-only tool"}
      </li>}
      {audit
        ? audit.toolCalls.flatMap((call) => call.status === "completed" ? [
            <li className="done" key={`${call.toolCallId}:started`}>
              <i aria-hidden="true" />{language === "zh-CN" ? "调用" : "Use"} {analystToolLabel(call.name, language)}
              {call.input.period ? <small>{call.input.period}</small> : null}
            </li>,
            <li className="done" key={`${call.toolCallId}:completed`}>
              <i aria-hidden="true" />{language === "zh-CN"
                ? `返回 ${call.evidenceKeys.length} 条${analystToolLabel(call.name, language)}事实`
                : `${analystToolLabel(call.name, language)} returned ${call.evidenceKeys.length} current facts`}
              {call.factsAsOf ? <small>{new Date(call.factsAsOf).toLocaleString()}</small> : null}
            </li>,
          ] : [
            <li className={call.status} key={`${call.toolCallId}:${call.status}`}>
              <i aria-hidden="true" />{call.status === "blocked"
                ? (language === "zh-CN" ? "阻止额外工具调用" : "Blocked an extra tool call")
                : (language === "zh-CN" ? "工具调用失败" : "Tool call failed")}
              <small>{analystToolLabel(call.name, language)}</small>
            </li>,
          ])
        : streamedActivities.map((activity) => (
            <li
              className={activity.stage === "completed" || completedStreamedCalls.has(activity.toolCallId)
                ? "done"
                : interrupted ? "failed" : "active"}
              key={`${activity.toolCallId}:${activity.stage}`}
            >
              <i aria-hidden="true" />{activity.stage === "started"
                ? `${language === "zh-CN" ? "调用" : "Use"} ${analystToolLabel(activity.name, language)}`
                : (language === "zh-CN"
                    ? `返回 ${activity.evidenceCount} 条${analystToolLabel(activity.name, language)}事实`
                    : `${analystToolLabel(activity.name, language)} returned ${activity.evidenceCount} current facts`)}
              <small>{activity.stage === "started"
                ? activity.input.period
                : new Date(activity.factsAsOf).toLocaleString()}</small>
            </li>
          ))}
      {showGeneration && <li className={phase === "completed" ? "done" : interrupted ? "failed" : "active"}>
        <i aria-hidden="true" />{interrupted
          ? (language === "zh-CN" ? "回答生成未完成" : "Answer generation did not complete")
          : (language === "zh-CN" ? "生成并验证回答" : "Generate and validate the answer")}
      </li>}
    </ol>
  );
}

export function AnalystReport({
  report,
}: {
  report: PortfolioAnalystReport;
}) {
  const language = report.language;
  const evidence = new Map(report.evidence.map((fact) => [fact.key, fact]));
  const answer = report.answer;
  return (
    <article className="portfolio-analyst-result" aria-live="polite">
      {report.agentAudit && (
        <AgentActivityTimeline audit={report.agentAudit} language={language} phase="completed" />
      )}
      <div className="analyst-primary-answer analyst-assistant-message">
        <span>Portfolio Agent</span>
        <p>{answer.answer.text}</p>
      </div>
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
                  <li key={limitation.code}>
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
        </div>
      </details>
      <small className="analyst-disclaimer">
        {report.job === "explain-period-drivers"
          ? `Performance drivers · ${report.scope.period ?? "period"}`
          : "Data quality diagnosis"} · Facts as of {new Date(report.factsAsOf).toLocaleString()} · {providerNames[report.provider]} · {report.model} · {language === "zh-CN" ? "生成于" : "Generated"} {new Date(report.generatedAt).toLocaleString()} · {report.disclaimer}
      </small>
    </article>
  );
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
