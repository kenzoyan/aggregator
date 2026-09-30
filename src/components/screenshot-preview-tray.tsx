"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { screenshotFileKey } from "@/components/screenshot-selection";

interface ScreenshotPreview {
  file: File;
  key: string;
  url: string;
}

export function ScreenshotPreviewTray({
  files,
  disabled,
  onRemove,
  addControl,
  heading = "Reference screenshots",
  helperText,
  listLabel = "Selected screenshots",
}: {
  files: readonly File[];
  disabled: boolean;
  onRemove: (file: File) => void;
  addControl?: ReactNode;
  heading?: ReactNode;
  helperText?: ReactNode;
  listLabel?: string;
}) {
  const [previews, setPreviews] = useState<ScreenshotPreview[]>([]);
  const [activeKey, setActiveKey] = useState<string>();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const next = files.map((file) => ({
      file,
      key: screenshotFileKey(file),
      url: URL.createObjectURL(file),
    }));
    setPreviews(next);
    return () => next.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [files]);

  const activeIndex = previews.findIndex((preview) => preview.key === activeKey);
  const active = activeIndex >= 0 ? previews[activeIndex] : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && !dialog.open) dialog.showModal();
    if (!active && dialog.open) dialog.close();
  }, [active]);

  if (files.length === 0) return null;

  return (
    <section className="screenshot-tray" aria-labelledby="screenshot-tray-heading">
      <div className="screenshot-tray-heading">
        <div>
          <strong id="screenshot-tray-heading">{heading}</strong>
          <small>{helperText ?? `${files.length} of 6 · kept only for this page session`}</small>
        </div>
      </div>
      <ul className="screenshot-thumbnails" aria-label={listLabel}>
        {addControl && <li className="screenshot-add-item">{addControl}</li>}
        {previews.map((preview, index) => (
          <li key={preview.key}>
            <button
              className="screenshot-thumbnail"
              type="button"
              onClick={() => setActiveKey(preview.key)}
              aria-label={`Open screenshot ${index + 1}: ${preview.file.name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URLs are not supported by next/image */}
              <img src={preview.url} alt="" />
              <span>{index + 1}</span>
            </button>
            <button
              className="screenshot-remove"
              type="button"
              disabled={disabled}
              onClick={() => onRemove(preview.file)}
              aria-label={`Remove screenshot ${index + 1}: ${preview.file.name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <dialog
        className="screenshot-lightbox"
        ref={dialogRef}
        aria-labelledby="screenshot-preview-title"
        onClose={() => setActiveKey(undefined)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setActiveKey(undefined);
        }}
      >
        {active && (
          <div className="screenshot-lightbox-panel">
            <header>
              <div>
                <strong id="screenshot-preview-title">Screenshot {activeIndex + 1} of {previews.length}</strong>
                <small>{active.file.name}</small>
              </div>
              <button type="button" onClick={() => setActiveKey(undefined)} aria-label="Close screenshot preview">×</button>
            </header>
            <div className="screenshot-lightbox-image">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URLs are not supported by next/image */}
              <img src={active.url} alt={`Full-size preview of ${active.file.name}`} />
            </div>
            {previews.length > 1 && (
              <footer>
                <button
                  type="button"
                  disabled={activeIndex === 0}
                  onClick={() => setActiveKey(previews[activeIndex - 1]!.key)}
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  disabled={activeIndex === previews.length - 1}
                  onClick={() => setActiveKey(previews[activeIndex + 1]!.key)}
                >
                  Next →
                </button>
              </footer>
            )}
          </div>
        )}
      </dialog>
    </section>
  );
}
