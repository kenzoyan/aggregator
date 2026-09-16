export const maximumScreenshotCount = 6;

export interface ScreenshotFileIdentity {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export function screenshotFileKey(file: ScreenshotFileIdentity): string {
  return JSON.stringify([file.name, file.size, file.type, file.lastModified]);
}

export function screenshotSelectionSignature(
  files: readonly ScreenshotFileIdentity[],
): string {
  return JSON.stringify(files.map(screenshotFileKey));
}

export function mergeScreenshotFiles<T extends ScreenshotFileIdentity>(
  current: readonly T[],
  incoming: readonly T[],
  maximum = maximumScreenshotCount,
): { files: T[]; duplicateCount: number; overflowCount: number } {
  const files = [...current];
  const keys = new Set(files.map(screenshotFileKey));
  let duplicateCount = 0;
  let overflowCount = 0;

  for (const file of incoming) {
    const key = screenshotFileKey(file);
    if (keys.has(key)) {
      duplicateCount += 1;
    } else if (files.length >= maximum) {
      overflowCount += 1;
    } else {
      files.push(file);
      keys.add(key);
    }
  }

  return { files, duplicateCount, overflowCount };
}

export function removeScreenshotFile<T extends ScreenshotFileIdentity>(
  files: readonly T[],
  target: ScreenshotFileIdentity,
): T[] {
  const targetKey = screenshotFileKey(target);
  return files.filter((file) => screenshotFileKey(file) !== targetKey);
}
