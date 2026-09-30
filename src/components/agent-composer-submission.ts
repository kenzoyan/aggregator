export interface AgentComposerSubmission<TScreenshot> {
  text: string;
  screenshots: readonly TScreenshot[];
}

export function createAgentComposerSubmission<TScreenshot>({
  text,
  screenshots,
}: {
  text: string;
  screenshots: readonly TScreenshot[];
}): AgentComposerSubmission<TScreenshot> | undefined {
  const normalizedText = text.trim();
  if (!normalizedText && screenshots.length === 0) return undefined;

  return {
    text: normalizedText,
    screenshots: [...screenshots],
  };
}

export function readTextOnlyAgentQuestion<TScreenshot>(
  submission: AgentComposerSubmission<TScreenshot> | undefined,
): string | undefined {
  if (!submission || submission.screenshots.length > 0 || !submission.text) {
    return undefined;
  }
  return submission.text;
}
