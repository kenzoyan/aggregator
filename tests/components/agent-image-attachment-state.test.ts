import { describe, expect, it } from "vitest";

import {
  addAgentImageAttachments,
  createAgentImageAttachmentState,
  lockAgentImageAttachments,
  projectAgentImageAttachmentMetadata,
  removeAgentImageAttachment,
  resetAgentImageAttachments,
  unlockAgentImageAttachments,
} from "@/components/agent-image-attachment-state";

function image(name: string, lastModified: number) {
  return {
    name,
    size: 1_024,
    type: "image/png",
    lastModified,
    privateBytes: new Uint8Array([1, 2, 3]),
    objectUrl: `blob:private-${lastModified}`,
  };
}

describe("Agent image attachment state", () => {
  it("uses the canonical duplicate and six-image selection policy", () => {
    const first = image("overview.png", 1);
    const incoming = [
      first,
      ...Array.from({ length: 6 }, (_, index) =>
        image(`detail-${index + 1}.png`, index + 2)
      ),
    ];

    const state = addAgentImageAttachments(
      createAgentImageAttachmentState([first]),
      incoming,
    );

    expect(state.files).toHaveLength(6);
    expect(state.duplicateCount).toBe(1);
    expect(state.overflowCount).toBe(1);
  });

  it("does not add or remove files while the selection is locked", () => {
    const first = image("overview.png", 1);
    const locked = lockAgentImageAttachments(
      createAgentImageAttachmentState([first]),
    );

    expect(addAgentImageAttachments(locked, [image("new.png", 2)]))
      .toBe(locked);
    expect(removeAgentImageAttachment(locked, first)).toBe(locked);
    expect(locked.locked).toBe(true);
    expect(unlockAgentImageAttachments(locked)).toEqual({ ...locked, locked: false });
  });

  it("removes one file and reset clears even a locked selection", () => {
    const first = image("overview.png", 1);
    const second = image("detail.png", 2);
    const state = createAgentImageAttachmentState([first, second]);

    expect(removeAgentImageAttachment(state, second).files).toEqual([first]);
    expect(resetAgentImageAttachments(lockAgentImageAttachments(state)))
      .toEqual(createAgentImageAttachmentState());
  });

  it("projects ordered metadata without private bytes or object URLs", () => {
    const state = createAgentImageAttachmentState([
      image("overview.png", 1),
      image("detail.png", 2),
    ]);

    const metadata = projectAgentImageAttachmentMetadata(state.files);

    expect(metadata).toEqual([{
      order: 1,
      name: "overview.png",
      size: 1_024,
      mediaType: "image/png",
      lastModified: 1,
    }, {
      order: 2,
      name: "detail.png",
      size: 1_024,
      mediaType: "image/png",
      lastModified: 2,
    }]);
    expect(JSON.stringify(metadata)).not.toMatch(/privateBytes|objectUrl|blob:/);
  });
});
