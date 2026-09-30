"use client";

import { useId, type ChangeEvent } from "react";

import {
  addAgentImageAttachments,
  removeAgentImageAttachment,
  type AgentImageAttachmentState,
} from "@/components/agent-image-attachment-state";
import { maximumScreenshotCount } from "@/components/screenshot-selection";
import { ScreenshotPreviewTray } from "@/components/screenshot-preview-tray";

const acceptedImageTypes = "image/jpeg,image/png,image/webp";

export function AgentImageAttachments({
  state,
  language,
  onChange,
}: {
  state: AgentImageAttachmentState<File>;
  language: "en" | "zh-CN";
  onChange: (state: AgentImageAttachmentState<File>) => void;
}) {
  const inputId = useId();
  const copy = language === "zh-CN" ? {
    add: "添加截图",
    heading: "待发送截图",
    selected: "已选择的截图",
    helper: `${state.files.length} / ${maximumScreenshotCount} · 仅保留在当前页面`,
    duplicates: `${state.duplicateCount} 张重复截图已忽略。`,
    overflow: `一次最多发送 ${maximumScreenshotCount} 张截图。`,
  } : {
    add: "Add screenshots",
    heading: "Screenshots to send",
    selected: "Selected screenshots",
    helper: `${state.files.length} of ${maximumScreenshotCount} · kept only for this page session`,
    duplicates: `${state.duplicateCount} duplicate screenshot${state.duplicateCount === 1 ? " was" : "s were"} ignored.`,
    overflow: `Send up to ${maximumScreenshotCount} screenshots at a time.`,
  };

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    onChange(addAgentImageAttachments(state, files));
    event.currentTarget.value = "";
  }

  const addControl = !state.locked && state.files.length < maximumScreenshotCount ? (
    <label className="screenshot-add-tile" htmlFor={inputId}>
      <span aria-hidden="true">＋</span>
      <strong>{copy.add}</strong>
      <input
        id={inputId}
        type="file"
        accept={acceptedImageTypes}
        multiple
        disabled={state.locked}
        onChange={selectFiles}
      />
    </label>
  ) : undefined;

  return (
    <div className="agent-image-attachments">
      {state.files.length === 0 ? (
        <label className="agent-image-attachment-trigger" htmlFor={inputId}>
          <span aria-hidden="true">＋</span>
          <strong>{copy.add}</strong>
          <input
            id={inputId}
            type="file"
            accept={acceptedImageTypes}
            multiple
            disabled={state.locked}
            onChange={selectFiles}
          />
        </label>
      ) : (
        <ScreenshotPreviewTray
          files={state.files}
          disabled={state.locked}
          onRemove={(file) => onChange(removeAgentImageAttachment(state, file))}
          addControl={addControl}
          heading={copy.heading}
          helperText={copy.helper}
          listLabel={copy.selected}
        />
      )}
      {(state.duplicateCount > 0 || state.overflowCount > 0) && (
        <p className="agent-image-attachment-feedback" role="status">
          {[
            state.duplicateCount > 0 ? copy.duplicates : undefined,
            state.overflowCount > 0 ? copy.overflow : undefined,
          ].filter(Boolean).join(" ")}
        </p>
      )}
    </div>
  );
}
