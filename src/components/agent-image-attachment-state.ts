import {
  mergeScreenshotFiles,
  removeScreenshotFile,
  type ScreenshotFileIdentity,
} from "@/components/screenshot-selection";

export interface AgentImageAttachmentState<
  T extends ScreenshotFileIdentity = ScreenshotFileIdentity,
> {
  files: T[];
  locked: boolean;
  duplicateCount: number;
  overflowCount: number;
}

export interface AgentImageAttachmentMetadata {
  order: number;
  name: string;
  size: number;
  mediaType: string;
  lastModified: number;
}

export function createAgentImageAttachmentState<
  T extends ScreenshotFileIdentity = ScreenshotFileIdentity,
>(files: readonly T[] = []): AgentImageAttachmentState<T> {
  return {
    files: [...files],
    locked: false,
    duplicateCount: 0,
    overflowCount: 0,
  };
}

export function addAgentImageAttachments<T extends ScreenshotFileIdentity>(
  state: AgentImageAttachmentState<T>,
  incoming: readonly T[],
): AgentImageAttachmentState<T> {
  if (state.locked) return state;
  const selection = mergeScreenshotFiles(state.files, incoming);
  return { ...state, ...selection };
}

export function removeAgentImageAttachment<T extends ScreenshotFileIdentity>(
  state: AgentImageAttachmentState<T>,
  target: ScreenshotFileIdentity,
): AgentImageAttachmentState<T> {
  if (state.locked) return state;
  return {
    ...state,
    files: removeScreenshotFile(state.files, target),
    duplicateCount: 0,
    overflowCount: 0,
  };
}

export function lockAgentImageAttachments<T extends ScreenshotFileIdentity>(
  state: AgentImageAttachmentState<T>,
): AgentImageAttachmentState<T> {
  return state.locked ? state : { ...state, locked: true };
}

export function unlockAgentImageAttachments<T extends ScreenshotFileIdentity>(
  state: AgentImageAttachmentState<T>,
): AgentImageAttachmentState<T> {
  return state.locked ? { ...state, locked: false } : state;
}

export function resetAgentImageAttachments<
  T extends ScreenshotFileIdentity,
>(_state: AgentImageAttachmentState<T>): AgentImageAttachmentState<T> {
  return createAgentImageAttachmentState<T>();
}

export function projectAgentImageAttachmentMetadata(
  files: readonly ScreenshotFileIdentity[],
): AgentImageAttachmentMetadata[] {
  return files.map((file, index) => ({
    order: index + 1,
    name: file.name,
    size: file.size,
    mediaType: file.type,
    lastModified: file.lastModified,
  }));
}
