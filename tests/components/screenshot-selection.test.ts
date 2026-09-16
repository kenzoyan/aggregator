import { describe, expect, it } from "vitest";

import {
  mergeScreenshotFiles,
  removeScreenshotFile,
  screenshotSelectionSignature,
} from "@/components/screenshot-selection";

function image(name: string, lastModified: number) {
  return {
    name,
    size: 1_024,
    type: "image/png",
    lastModified,
  };
}

describe("screenshot selection", () => {
  it("appends new screenshots while ignoring duplicates", () => {
    const first = image("overview.png", 1);
    const second = image("details.png", 2);

    expect(mergeScreenshotFiles([first], [first, second])).toEqual({
      files: [first, second],
      duplicateCount: 1,
      overflowCount: 0,
    });
  });

  it("keeps at most six screenshots and reports overflow", () => {
    const files = Array.from({ length: 7 }, (_, index) =>
      image(`screen-${index + 1}.png`, index + 1)
    );

    const result = mergeScreenshotFiles([], files);

    expect(result.files).toEqual(files.slice(0, 6));
    expect(result.overflowCount).toBe(1);
  });

  it("removes only the selected screenshot and changes the selection signature", () => {
    const first = image("overview.png", 1);
    const second = image("details.png", 2);
    const before = screenshotSelectionSignature([first, second]);

    const remaining = removeScreenshotFile([first, second], second);

    expect(remaining).toEqual([first]);
    expect(screenshotSelectionSignature(remaining)).not.toBe(before);
  });
});
