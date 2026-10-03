import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PortfolioAnalystImageAttachment } from "@/application/portfolio-analyst-conversation";

export interface PortfolioAnalystImageStore {
  save(attachment: PortfolioAnalystImageAttachment, bytes: Uint8Array): Promise<void>;
  read(attachment: PortfolioAnalystImageAttachment): Promise<Uint8Array | undefined>;
  delete(attachment: PortfolioAnalystImageAttachment): Promise<void>;
}

const extensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function imageFilename(attachment: PortfolioAnalystImageAttachment): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachment.id)) {
    throw new Error("Invalid image reference.");
  }
  return `${attachment.id}.${extensions[attachment.mimeType]}`;
}

export function createLocalPortfolioAnalystImageStore(
  directory = join(process.cwd(), "data", "agent-images"),
): PortfolioAnalystImageStore {
  return {
    async save(attachment, bytes) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, imageFilename(attachment)), bytes, {
        flag: "wx", mode: 0o600,
      });
    },
    async read(attachment) {
      try {
        return new Uint8Array(await readFile(join(directory, imageFilename(attachment))));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async delete(attachment) {
      await rm(join(directory, imageFilename(attachment)), { force: true });
    },
  };
}
