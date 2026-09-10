"use client";

import { useEffect, useRef, useState } from "react";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type {
  AnalystEvidenceFact,
  PortfolioAnalystLanguage,
} from "@/application/portfolio-analyst-context";
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
  providers: Array<{
    id: PortfolioAnalystProviderId;
    configured: boolean;
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
        const preferred = value.providers.find((item) =>
          item.id === value.defaultProvider && item.configured
        ) ?? value.providers.find((item) => item.configured);
        const restored = value.conversation;
        const latestReport = restored?.turns.at(-1)?.report;
        setConversation(restored);
        setProvider(restored?.provider ?? preferred?.id ?? value.defaultProvider);
        setLanguage(restored?.language ?? "zh-CN");
        setIncludeHoldingNames(restored?.includeHoldingNames ?? true);
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

  async function runAnalyst() {
    const normalizedQuestion = question.trim();
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
    } catch {
      if (conversation) {
        setError("The local conversation could not be deleted.");
      }
    }
  }

  const settingsLocked = Boolean(conversation?.turns.length);

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
        <details className="portfolio-agent-settings">
          <summary>
            <span>{language === "zh-CN" ? "对话设置" : "Conversation settings"}</span>
            <small>
              {providerNames[provider]} · {period} · {language === "zh-CN" ? "中文" : "English"}
            </small>
          </summary>
        <div className="portfolio-analyst-controls">
          <label>
            <span>Default period</span>
            <select disabled={loading} value={period} onChange={(event) => {
              setPeriod(event.target.value as Period);
              setError(undefined);
            }}>
              <option value="today">Today</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label>
            <span>Provider</span>
            <select disabled={loading || settingsLocked} value={provider} onChange={(event) => {
              setProvider(event.target.value as PortfolioAnalystProviderId);
              setError(undefined);
            }}>
              {(configuration?.providers ?? [
                { id: "openai" as const, configured: false, model: "" },
                { id: "deepseek" as const, configured: false, model: "" },
              ]).map((item) => (
                <option key={item.id} value={item.id}>
                  {providerNames[item.id]}{item.configured ? "" : " · not configured"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select disabled={loading || settingsLocked} value={language} onChange={(event) => {
              setLanguage(event.target.value as PortfolioAnalystLanguage);
              setError(undefined);
            }}>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="analyst-name-toggle">
            <input
              type="checkbox"
              disabled={loading || settingsLocked}
              checked={includeHoldingNames}
              onChange={(event) => {
                setIncludeHoldingNames(event.target.checked);
                setError(undefined);
              }}
            />
            <span>Allow up to 3 relevant holding names</span>
          </label>
          {settingsLocked && (
            <span className="analyst-settings-note">Reset the conversation to change provider, language or name privacy.</span>
          )}
        </div>
        </details>

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
              <strong>{language === "zh-CN" ? "从一个有范围的问题开始" : "Start with one bounded question"}</strong>
              <p>{language === "zh-CN"
                ? "例如：本周为什么上涨？然后继续问：FX 为什么是正的？"
                : "For example: Why did the portfolio rise this week? Then ask why the FX effect was positive."}</p>
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
              <div className={`analyst-streaming-message ${pendingTurn.phase}`}>
                <span>Portfolio Agent</span>
                {pendingTurn.answerText ? (
                  <>
                    <p>{pendingTurn.answerText}<i aria-hidden="true" /></p>
                    <small>{language === "zh-CN" ? "生成中 · 完成后验证证据" : "Generating · evidence is validated on completion"}</small>
                  </>
                ) : (
                  <p>{pendingPhaseLabel(pendingTurn.phase, language)}</p>
                )}
              </div>
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

function AnalystReport({
  report,
}: {
  report: PortfolioAnalystReport;
}) {
  const language = report.language;
  const evidence = new Map(report.evidence.map((fact) => [fact.key, fact]));
  const answer = report.answer;
  return (
    <article className="portfolio-analyst-result" aria-live="polite">
      <div className="portfolio-analyst-meta">
        <span>{providerNames[report.provider]} · {report.model}</span>
        <span>
          {report.job === "explain-period-drivers"
            ? `Performance drivers · ${report.scope.period ?? "period"}`
            : "Data quality diagnosis"}
        </span>
        <span>Facts as of {new Date(report.factsAsOf).toLocaleString()}</span>
        <span>Generated {new Date(report.generatedAt).toLocaleString()}</span>
      </div>
      {report.agentAudit && (
        <details className="portfolio-agent-audit">
          <summary>
            {language === "zh-CN" ? "Agent 执行记录" : "Agent run"}
            <span>
              {report.agentAudit.toolCalls
                .filter((call) => call.status === "completed")
                .map((call) => call.name === "read_period_drivers"
                  ? (language === "zh-CN" ? "期间表现" : "Period drivers")
                  : (language === "zh-CN" ? "数据质量" : "Data quality"))
                .join(" · ")}
            </span>
          </summary>
          <p>
            {language === "zh-CN"
              ? `Pi 用 ${report.agentAudit.modelTurns} 个模型回合完成：先选择只读工具，再基于新读取的事实回答。`
              : `Pi completed in ${report.agentAudit.modelTurns} model turns: choose a read-only tool, then answer from freshly read facts.`}
          </p>
          <ul>
            {report.agentAudit.toolCalls.map((call) => (
              <li key={call.toolCallId}>
                <code>{call.name}</code>
                <span>{language === "zh-CN"
                  ? ({ completed: "完成", blocked: "已阻止", failed: "失败" } as const)[call.status]
                  : call.status}</span>
                <small>
                  {call.factsAsOf
                    ? `${new Date(call.factsAsOf).toLocaleString()} · ${call.evidenceKeys.length} Evidence Keys`
                    : call.errorCode}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="analyst-primary-answer">
        <Classification value={answer.answer.classification} />
        <p>{answer.answer.text}</p>
        <EvidenceKeys keys={answer.answer.evidence} facts={evidence} />
      </div>
      {answer.claims.length > 0 && (
        <ul className="analyst-claims">
          {answer.claims.map((claim, index) => (
            <li key={`${index}:${claim.text}`}>
              <Classification value={claim.classification} />
              <p>{claim.text}</p>
              <EvidenceKeys keys={claim.evidence} facts={evidence} />
            </li>
          ))}
        </ul>
      )}
      {answer.limitations.length > 0 && (
        <div className="analyst-limitations">
          <strong>{language === "zh-CN" ? "已知限制" : "Known limitations"}</strong>
          <ul>
            {answer.limitations.map((limitation) => (
              <li key={limitation.code}>
                {portfolioAnalystLimitationLabel(limitation.code, language)}
                <EvidenceKeys keys={[limitation.evidenceKey]} facts={evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {answer.proposedUpdate && (
        <div className="analyst-proposed-update">
          <span>{language === "zh-CN" ? "建议的事实更新（未执行）" : "Suggested factual update (not executed)"}</span>
          <strong>{portfolioAnalystActionLabel(answer.proposedUpdate, language)}</strong>
          <EvidenceKeys keys={[answer.proposedUpdate.reasonEvidenceKey]} facts={evidence} />
        </div>
      )}
      <details className="portfolio-analyst-evidence">
        <summary>{language === "zh-CN" ? `查看引用的 ${report.evidence.length} 条本地事实` : `View ${report.evidence.length} cited local facts`}</summary>
        <dl>
          {report.evidence.map((fact) => (
            <div key={fact.key} id={`analyst-fact-${fact.key}`}>
              <dt>{fact.label}<small>{fact.key} · {fact.provenance}</small></dt>
              <dd>{portfolioAnalystEvidenceValue(fact, language)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <small className="analyst-disclaimer">{report.disclaimer}</small>
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
}: {
  keys: string[];
  facts: Map<string, AnalystEvidenceFact>;
}) {
  return (
    <small className="analyst-evidence-keys">
      Based on: {keys.map((key) => facts.get(key)?.label ?? key).join(" · ")}
    </small>
  );
}
