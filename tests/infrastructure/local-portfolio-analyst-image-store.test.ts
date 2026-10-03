import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local Portfolio Agent image storage", () => {
  it("stores opaque image references in a private directory and removes them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-images-"));
    directories.push(directory);
    const store = createLocalPortfolioAnalystImageStore(directory);
    const attachment = {
      id: "11111111-1111-4111-8111-111111111111",
      mimeType: "image/png" as const,
      byteLength: 3,
    };
    await store.save(attachment, new Uint8Array([1, 2, 3]));
    expect(await readdir(directory)).toEqual([`${attachment.id}.png`]);
    expect(await store.read(attachment)).toEqual(new Uint8Array([1, 2, 3]));
    await store.delete(attachment);
    expect(await store.read(attachment)).toBeUndefined();
  });

  it("rejects path-shaped identifiers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-images-"));
    directories.push(directory);
    const store = createLocalPortfolioAnalystImageStore(directory);
    await expect(store.save({
      id: "../outside", mimeType: "image/png", byteLength: 1,
    }, new Uint8Array([1]))).rejects.toThrow("Invalid image reference");
  });
});
