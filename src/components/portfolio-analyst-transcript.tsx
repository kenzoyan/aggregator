"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  PortfolioAnalystAgentAudit,
  PortfolioAnalystToolAudit,
  PortfolioAnalystToolActivity,
  PortfolioAnalystToolName,
} from "@/application/portfolio-analyst-agent";
import type { PortfolioAnalystConversation, PortfolioAnalystImageAttachment } from "@/application/portfolio-analyst-conversation";
import { importDateFollowUpQuestion, type ImportDateFollowUp } from "@/application/imports/import-chat-follow-up";
import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import type {
  AnalystEvidenceFact,
  FactualUpdate,
  PortfolioAnalystLanguage,
} from "@/application/portfolio-analyst-contract";
import {
  portfolioAnalystActionLabel,
  portfolioAnalystEvidenceValue,
  portfolioAnalystLimitationLabel,
} from "@/application/portfolio-analyst-presentation";
import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import type { PendingPortfolioAnalystTurn } from "@/application/portfolio-analyst-stream";
import { analystHistoryEntries, analystHistoryDay, analystHistoryDateLabel, initialVisibleHistoryCount } from "@/components/analyst-history-presentation";
import { AssistantMessageContent } from "@/components/assistant-message-content";

import { analystWorkspaceActions, analystWorkspaceActionLabel, type AnalystWorkspaceSelection } from "@/components/analyst-workspace-selection";

const classificationLabels: Record<
  PortfolioAnalystAnswer["answer"]["classification"],
  string
> = {
  fact: "Fact",
  calculation: "Calculation",
  estimate: "Estimate",
  interpretation: "Interpretation",
};

interface SavedConversationEntriesProps {
  conversation: PortfolioAnalystConversation;
  importDrafts: Record<string, ImportDraftReadModel>;
  activeReviewDraftId?: string;
  activeDateRequest?: ImportDateFollowUp;
  language: PortfolioAnalystLanguage;
  accountActionStatus: Record<string, "confirming" | "created" | "failed">;
  loading: boolean;
  importBusy: boolean;
  onConfirmCreateAccount: (turnId: string, action: Extract<FactualUpdate, { kind: "create-account" }>) => void;
  onViewDetail?: (selection: AnalystWorkspaceSelection) => void;
  onFollowUp?: (question: string) => void;
  onRetryTurn: (turnId: string) => void;
  onRetryWorkflowReply?: (turnId: string) => void;
  onReviewDraft: (draftId: string) => void;
}

export function SavedConversationEntries({
  conversation, importDrafts, activeReviewDraftId, activeDateRequest, language,
  accountActionStatus,
  loading, importBusy, onConfirmCreateAccount, onViewDetail, onFollowUp, onRetryTurn, onRetryWorkflowReply, onReviewDraft,
}: SavedConversationEntriesProps) {
  const entries = analystHistoryEntries(conversation);
  // Keep the beginning fixed as new replies arrive, so reading history never removes a visible turn.
  const [hiddenCount, setHiddenCount] = useState(() => Math.max(0, entries.length - initialVisibleHistoryCount));
  const visible = entries.slice(hiddenCount);
  return <>
    {hiddenCount > 0 && <button type="button" className="analyst-history-more" onClick={() => setHiddenCount((count) => Math.max(0, count - initialVisibleHistoryCount))}>
      {language === "zh-CN" ? "查看更早记录" : "View earlier messages"}
    </button>}
    {visible.map((entry, index) => <Fragment key={entry.id}>
      {(index === 0 || analystHistoryDay(entry.at) !== analystHistoryDay(visible[index - 1]!.at)) &&
        <div className="analyst-date-divider"><time dateTime={entry.at}>{analystHistoryDateLabel(entry.at, language)}</time></div>}
      <div data-entry-id={entry.id}>
      {entry.kind === "turn" ? (
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
            onConfirmCreateAccount={(action) => onConfirmCreateAccount(entry.turn.id, action)}
            onViewDetail={onViewDetail}
            onFollowUp={entry.turn.id === conversation.turns.at(-1)?.id ? onFollowUp : undefined}
          /> : entry.turn.imageAnswer ? <>
            {entry.turn.imageAnswer.status === "pending" || entry.turn.imageAnswer.status === "failed" ? (
              <div className="analyst-import-chat-status" role="status">
                <span>{language === "zh-CN" ? "图片回复未完成。" : "Image reply is incomplete."}</span>
                <button type="button" disabled={loading || importBusy} onClick={() => onRetryTurn(entry.turn.id)}>
                  {language === "zh-CN" ? "重试回复" : "Retry reply"}
                </button>
              </div>
            ) : <div className="analyst-primary-answer analyst-assistant-message">
              <AssistantMessageContent text={entry.turn.imageAnswer.text} />
              {entry.turn.imageAnswer.uncertainties.length > 0 && <ul>{entry.turn.imageAnswer.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>}
            </div>}
          </> : entry.turn.chat?.failureCode ? <div className="analyst-import-chat-status" role="alert">
            <span>{entry.turn.chat.assistantText || pendingPhaseLabel("failed", language, entry.turn.chat.failureCode)}</span>
            <button type="button" disabled={loading || importBusy} onClick={() => onRetryTurn(entry.turn.id)}>
              {language === "zh-CN" ? "重试回复" : "Retry reply"}
            </button>
          </div> : entry.turn.chat?.requestStatus === "pending" && !entry.turn.chat.workflowResult && !loading && !importBusy ? <div className="analyst-import-chat-status" role="status">
            <span>{language === "zh-CN" ? "回复未完成。" : "Reply is incomplete."}</span>
            <button type="button" onClick={() => onRetryTurn(entry.turn.id)}>{language === "zh-CN" ? "重试回复" : "Retry reply"}</button>
          </div> : entry.turn.chat && (entry.turn.chat.assistantText && entry.turn.chat.requestStatus !== "pending" || entry.turn.chat.workflowResult && !loading && !importBusy)
            ? <>
              {entry.turn.chat.assistantText && entry.turn.chat.requestStatus !== "pending" && <div className="analyst-primary-answer analyst-assistant-message">
                <AssistantMessageContent text={entry.turn.chat.assistantText} />
                {entry.turn.chat.memoryProposal?.status === "saved" && <small>{language === "zh-CN" ? "记忆已保存。" : "Memory saved."}</small>}
                {entry.turn.chat.memoryProposal?.status === "cancelled" && <small>{language === "zh-CN" ? "记忆未保存。" : "Memory not saved."}</small>}
              </div>}
              {entry.turn.chat.workflowResult && (!entry.turn.chat.assistantText || entry.turn.chat.requestStatus === "pending") && <div className="analyst-import-chat-status" role="status">
                <span>{language === "zh-CN" ? "操作结果已记录，回复未完成。" : "Operation result recorded; reply is incomplete."}</span>
                <button type="button" disabled={loading || importBusy} onClick={() => onRetryWorkflowReply?.(entry.turn.id)}>
                  {language === "zh-CN" ? "重试回复" : "Retry reply"}
                </button>
              </div>}
            </> : null}
        </div>
      ) : entry.kind === "import-follow-up" ? (
        <div className="analyst-turn" key={entry.followUp.id}>
          <div className="analyst-user-message"><p>{entry.followUp.userText}</p></div>
          <div className="analyst-primary-answer analyst-assistant-message"><AssistantMessageContent text={entry.followUp.assistantText} /></div>
        </div>
      ) : importDrafts[entry.activity.draftId] ? (
        <div className="analyst-import-chat-status" key={entry.activity.draftId}>
          <strong>{entry.activity.targetLabel}</strong>
          <span>{importDrafts[entry.activity.draftId].status === "confirmed"
            ? "Import confirmed · portfolio updated"
            : `${entry.activity.screenshotCount} screenshot${entry.activity.screenshotCount === 1 ? "" : "s"} analyzed · awaiting review`}</span>
          {entry.activity.draftId === activeReviewDraftId && !entry.activity.followUps?.length && activeDateRequest && <p>
            {importDateFollowUpQuestion(activeDateRequest, language)}
          </p>}
          {importDrafts[entry.activity.draftId].status === "draft" && (
            <button type="button" onClick={() => onReviewDraft(entry.activity.draftId)}>Review draft</button>
          )}
        </div>
      ) : null}
      </div>
    </Fragment>)}
  </>;
}

export function AgentMessageImages({ attachments }: { attachments: PortfolioAnalystImageAttachment[] }) {
  return <AgentImageCards images={attachments.map((attachment, index) => ({
    key: attachment.id,
    url: `/api/portfolio/analyst/images/${encodeURIComponent(attachment.id)}`,
    label: `Screenshot ${index + 1}`,
  }))} />;
}

export function PendingAgentMessageImages({ files }: { files: readonly File[] }) {
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

export function pendingPhaseLabel(
  phase: PendingPortfolioAnalystTurn["phase"],
  language: PortfolioAnalystLanguage,
  failureCode?: string,
) {
  if (phase === "failed") {
    const failures = language === "zh-CN" ? {
      "invalid-provider-output": "我无法核实模型刚才生成的回答。你的消息还在，可以重试。",
      "provider-unavailable": "模型服务暂时无法回应。你的消息还在，可以稍后重试。",
      "context-too-large": "这次请求的内容过长。请缩短问题后重试。",
      "connection-failed": "连接中断，回答没有完成。你的消息还在，可以重试。",
    } : {
      "invalid-provider-output": "I couldn't verify the model's answer. Your message is still here; please try again.",
      "provider-unavailable": "The model service couldn't respond. Your message is still here; please try again later.",
      "context-too-large": "This request has too much context. Please shorten your question and try again.",
      "connection-failed": "The connection ended before the reply was complete. Your message is still here; please try again.",
    };
    if (failureCode && Object.hasOwn(failures, failureCode)) {
      return failures[failureCode as keyof typeof failures];
    }
    return language === "zh-CN"
      ? "抱歉，这次回答失败了。你的消息还在，可以点“重试”再试一次。"
      : "Sorry, I couldn't finish that reply. Your message is still here; please try again.";
  }
  const labels = language === "zh-CN" ? {
    sending: "正在连接……",
    "selecting-tool": "正在查看你的问题……",
    "reading-current-facts": "正在查看相关资料……",
    "generating-answer": "正在生成回答……",
    stopped: "已停止。",
  } : {
    sending: "Connecting…",
    "selecting-tool": "Looking into your question…",
    "reading-current-facts": "Checking relevant information…",
    "generating-answer": "Generating an answer…",
    stopped: "Stopped.",
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
    read_all_holdings: "全部账户与持仓",
    read_accounts: "账户列表",
    read_account_holdings: "账户持仓",
    read_holding_history: "持仓历史",
    read_account_activity: "账户交易与提现",
    propose_create_account: "账户创建提议",
    prepare_account_import: "资产导入准备",
    search_web: "网络搜索",
    read_workflow_result: "操作结果",
    read_image: "截图内容",
    prepare_import_draft: "准备导入草稿", read_import_draft: "导入草稿", update_import_draft: "修改导入草稿", cancel_import_draft: "取消导入草稿", review_import_draft: "核对导入草稿",
    read_sale_draft: "卖出草稿", prepare_sale_draft: "准备卖出草稿", update_sale_draft: "修改卖出草稿",
    cancel_sale_draft: "取消卖出草稿", review_sale_draft: "核对卖出草稿",
    read_memories: "已保存的记忆",
    propose_memory: "记忆提议",
  } : {
    read_period_drivers: "period performance",
    read_data_quality: "data quality",
    read_portfolio_overview: "portfolio overview",
    read_all_holdings: "all accounts and holdings",
    read_accounts: "source accounts",
    read_account_holdings: "account holdings",
    read_holding_history: "holding history",
    read_account_activity: "account sales and withdrawals",
    propose_create_account: "account creation proposal",
    prepare_account_import: "asset import preparation",
    search_web: "web research",
    read_workflow_result: "operation result",
    read_image: "image observations",
    prepare_import_draft: "prepare import draft", read_import_draft: "import draft", update_import_draft: "update import draft", cancel_import_draft: "cancel import draft", review_import_draft: "review import draft",
    read_sale_draft: "sale draft", prepare_sale_draft: "prepare sale draft", update_sale_draft: "update sale draft",
    cancel_sale_draft: "cancel sale draft", review_sale_draft: "review sale draft",
    read_memories: "saved memories",
    propose_memory: "memory proposal",
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

function completedToolLabel(
  name: PortfolioAnalystToolName,
  input: PortfolioAnalystToolAudit["input"],
  language: PortfolioAnalystLanguage,
  evidenceCount: number,
  memoryCount?: number,
): string {
  if (name === "read_memories") {
    if (memoryCount === undefined) return language === "zh-CN" ? "已读取保存的记忆" : "Read saved memories";
    return language === "zh-CN"
      ? `已读取 ${memoryCount} 条已保存记忆`
      : `Read ${memoryCount} saved ${memoryCount === 1 ? "memory" : "memories"}`;
  }
  if (name === "propose_memory") return language === "zh-CN" ? "已检查记忆提议" : "Checked memory proposal";
  return language === "zh-CN"
    ? `已读取 ${analystToolScope(name, input, language)} · ${evidenceCount} 条当前事实`
    : `Read ${analystToolScope(name, input, language)} · ${evidenceCount} current facts`;
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
  if (calls.length === 0 && phase === "completed") return null;
  const currentLabel = phase === "completed"
    ? (language === "zh-CN" ? `已完成 ${calls.length} 项检查` : `${calls.length} checks completed`)
    : pendingPhaseLabel(phase, language);
  return (
    <details className={`analyst-activity-disclosure ${phase}`}>
      <summary><span className="analyst-status-light" aria-hidden="true" /><span role="status">{currentLabel}</span></summary>
    <ol className="analyst-agent-activity" aria-label={language === "zh-CN" ? "数据读取" : "Data checks"}>
      {audit
        ? audit.toolCalls.map((call) => (
            <li className={call.status === "completed" ? "done" : call.status} key={call.toolCallId}>
              <i aria-hidden="true" />{call.status === "completed"
                ? completedToolLabel(call.name, call.input, language, call.evidenceKeys.length, call.memoryCount)
                : call.status === "blocked"
                  ? (language === "zh-CN" ? `已停止额外读取：${analystToolScope(call.name, call.input, language)}` : `Stopped extra read: ${analystToolScope(call.name, call.input, language)}`)
                  : (language === "zh-CN" ? `读取失败：${analystToolScope(call.name, call.input, language)}` : `Failed to read ${analystToolScope(call.name, call.input, language)}`)}
            </li>
          ))
        : latestStreamedCalls.map((activity) => (
            <li
              className={activity.stage === "completed" ? "done" : activity.stage === "failed" || interrupted ? "failed" : "active"}
              key={activity.toolCallId}
            >
              <i aria-hidden="true" />{activity.stage === "started"
                ? (language === "zh-CN"
                    ? `正在读取 ${analystToolScope(activity.name, activity.input, language)}……`
                    : `Reading ${analystToolScope(activity.name, activity.input, language)}…`)
                : activity.stage === "failed"
                  ? (language === "zh-CN"
                      ? `读取失败：${analystToolScope(activity.name, activity.input, language)}`
                      : `Failed to read ${analystToolScope(activity.name, activity.input, language)}`)
                  : completedToolLabel(activity.name, activity.input, language, activity.evidenceCount, activity.memoryCount)}
            </li>
          ))}
    </ol>
    </details>
  );
}

export function AnalystReport({
  report,
  actionStatus,
  onConfirmCreateAccount,
  onViewDetail,
  onFollowUp,
  sourcesOnly = false,
}: {
  report: PortfolioAnalystReport;
  actionStatus?: "confirming" | "created" | "failed";
  onConfirmCreateAccount?: (
    action: Extract<FactualUpdate, { kind: "create-account" }>,
  ) => void;
  onViewDetail?: (selection: AnalystWorkspaceSelection) => void;
  onFollowUp?: (question: string) => void;
  sourcesOnly?: boolean;
}) {
  const language = report.language;
  const evidence = new Map(report.evidence.map((fact) => [fact.key, fact]));
  const answer = report.answer;
  const webSources = report.evidence.filter((fact) => fact.kind === "web-research-source");
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
        : report.job === "research-web"
          ? (language === "zh-CN" ? "外部资料" : "External research")
        : report.job === "manage-accounts"
          ? (language === "zh-CN" ? "账户管理" : "Account management")
          : (language === "zh-CN" ? "数据质量诊断" : "Data quality diagnosis");
  return (
    <article className={`portfolio-analyst-result${sourcesOnly ? " sources-only" : ""}`} aria-live={sourcesOnly ? undefined : "polite"}>
      {!sourcesOnly && <>
      <div className="analyst-primary-answer analyst-assistant-message">
        <AssistantMessageContent text={answer.answer.text} />
        {webSources.length > 0 && <ul className="analyst-web-sources" aria-label={language === "zh-CN" ? "外部来源" : "External sources"}>
          {webSources.map((source) => <li key={source.key}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
          </li>)}
        </ul>}
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
            {language === "zh-CN" ? "更多限制可在回答详情查看" : "More limitations in answer details"}
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
                  <dd>{portfolioAnalystEvidenceValue(fact, language)}{fact.kind === "web-research-source" && <>
                    {" · "}<a href={fact.url} target="_blank" rel="noopener noreferrer">{language === "zh-CN" ? "打开来源" : "Open source"}</a>
                  </>}</dd>
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
              <div><dt>{language === "zh-CN" ? "模型" : "Model"}</dt><dd>{report.provider === "openai" ? "OpenAI" : report.provider} · {report.model}</dd></div>
            </dl>
          </section>
        </div>
      </div>}
      {!sourcesOnly && onViewDetail && analystWorkspaceActions(report).length > 0 && <div className="analyst-context-actions">
        {analystWorkspaceActions(report).map((action) => <button type="button" key={action}
          onClick={() => onViewDetail({ action, report })}>{analystWorkspaceActionLabel(action, language)}<span aria-hidden="true">↗</span></button>)}
      </div>}
      {!sourcesOnly && onFollowUp && report.job === "explain-period-drivers" && <details className="analyst-explore">
        <summary>{language === "zh-CN" ? "继续探索" : "Continue exploring"}</summary>
        <button type="button" onClick={() => onFollowUp(language === "zh-CN" ? "价格变化和汇率分别对这个期间产生了什么影响？" : "How did price changes and FX each affect this period?")}>{language === "zh-CN" ? "进一步了解价格与汇率影响" : "Explore price and FX effects"}</button>
      </details>}
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
