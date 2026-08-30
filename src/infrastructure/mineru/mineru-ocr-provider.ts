import { unzipSync } from "fflate";
import { z } from "zod";

import type {
  DocumentOcrProvider,
  DocumentOcrRequest,
  DocumentOcrResult,
} from "@/application/imports/document-ocr";

const httpsUrl = z.string().url().refine(
  (value) => new URL(value).protocol === "https:",
);

const responseEnvelopeSchema = z.object({
  code: z.union([z.number(), z.string()]),
  msg: z.string().optional(),
  trace_id: z.string().optional(),
});

const createBatchSchema = z.object({
  data: z.object({
    batch_id: z.string().min(1),
    file_urls: z.array(httpsUrl).min(1),
  }),
});

const extractResultSchema = z.object({
  file_name: z.string().min(1),
  state: z.enum([
    "waiting-file",
    "pending",
    "running",
    "converting",
    "done",
    "failed",
  ]),
  full_zip_url: httpsUrl.optional(),
  err_msg: z.string().optional(),
});

const batchStatusSchema = z.object({
  data: z.object({
    batch_id: z.string().min(1),
    extract_result: z.array(extractResultSchema),
  }),
});

export type MinerUOcrErrorCode =
  | "not-configured"
  | "authentication-failed"
  | "rate-limited"
  | "daily-quota-exhausted"
  | "unsupported-file"
  | "file-too-large"
  | "parse-failed"
  | "timeout"
  | "service-unavailable";

const safeErrorMessages: Record<MinerUOcrErrorCode, string> = {
  "not-configured": "MinerU Precision is not configured on this device.",
  "authentication-failed": "MinerU Precision authentication failed.",
  "rate-limited": "MinerU is busy. Wait a minute and try again.",
  "daily-quota-exhausted":
    "MinerU Precision's daily parsing quota is exhausted. Try again tomorrow.",
  "unsupported-file": "MinerU does not support this screenshot format.",
  "file-too-large": "The screenshot exceeds MinerU's file size limit.",
  "parse-failed": "MinerU could not read this screenshot.",
  timeout: "MinerU did not finish reading the screenshot in time.",
  "service-unavailable": "MinerU is temporarily unavailable.",
};

export class MinerUOcrError extends Error {
  constructor(readonly code: MinerUOcrErrorCode) {
    super(safeErrorMessages[code]);
    this.name = "MinerUOcrError";
  }
}

function errorFromMinerUCode(code: string | number): MinerUOcrError {
  const normalized = String(code);
  if (normalized === "A0202" || normalized === "A0211") {
    return new MinerUOcrError("authentication-failed");
  }
  if (normalized === "-60002") {
    return new MinerUOcrError("unsupported-file");
  }
  if (normalized === "-60005") {
    return new MinerUOcrError("file-too-large");
  }
  if (normalized === "-60009") {
    return new MinerUOcrError("rate-limited");
  }
  if (normalized === "-60018") {
    return new MinerUOcrError("daily-quota-exhausted");
  }
  if (
    normalized === "-60003" ||
    normalized === "-60004" ||
    normalized === "-60006" ||
    normalized === "-60010" ||
    normalized === "-60011" ||
    normalized === "-60015" ||
    normalized === "-60016" ||
    normalized === "-60017" ||
    normalized === "-60020" ||
    normalized === "-60021"
  ) {
    return new MinerUOcrError("parse-failed");
  }
  return new MinerUOcrError("service-unavailable");
}

export interface MinerUPrecisionOcrProviderOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxPolls?: number;
  pollIntervalMs?: number;
  maxRequestAttempts?: number;
  maxZipBytes?: number;
  maxMarkdownBytes?: number;
  allowedUploadHosts?: readonly string[];
  allowedResultHosts?: readonly string[];
}

export class MinerUPrecisionOcrProvider implements DocumentOcrProvider {
  private readonly token: string;
  private readonly request: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxPolls: number;
  private readonly pollIntervalMs: number;
  private readonly maxRequestAttempts: number;
  private readonly maxZipBytes: number;
  private readonly maxMarkdownBytes: number;
  private readonly allowedUploadHosts: ReadonlySet<string>;
  private readonly allowedResultHosts: ReadonlySet<string>;

  constructor(
    token: string,
    options: MinerUPrecisionOcrProviderOptions = {},
  ) {
    this.token = token.trim();
    if (!this.token) throw new MinerUOcrError("not-configured");
    this.request = options.fetch ?? fetch;
    this.sleep = options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.maxPolls = options.maxPolls ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 3_000;
    this.maxRequestAttempts = options.maxRequestAttempts ?? 3;
    this.maxZipBytes = options.maxZipBytes ?? 20 * 1024 * 1024;
    this.maxMarkdownBytes = options.maxMarkdownBytes ?? 2 * 1024 * 1024;
    this.allowedUploadHosts = new Set(
      options.allowedUploadHosts ?? [
        "oss-mineru.openxlab.org.cn",
        "mineru.oss-cn-shanghai.aliyuncs.com",
      ],
    );
    this.allowedResultHosts = new Set(
      options.allowedResultHosts ?? ["cdn-mineru.openxlab.org.cn"],
    );
  }

  private authorizationHeaders() {
    return {
      authorization: `Bearer ${this.token}`,
    };
  }

  private assertAllowedHost(
    value: string,
    allowedHosts: ReadonlySet<string>,
  ) {
    let hostname: string;
    try {
      hostname = new URL(value).hostname;
    } catch {
      throw new MinerUOcrError("service-unavailable");
    }
    if (!allowedHosts.has(hostname)) {
      throw new MinerUOcrError("service-unavailable");
    }
  }

  private remainingTime(deadline: number): number {
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new MinerUOcrError("timeout");
    return remaining;
  }

  private async waitWithinDeadline(milliseconds: number, deadline: number) {
    const remaining = this.remainingTime(deadline);
    await this.sleep(Math.min(milliseconds, remaining));
    this.remainingTime(deadline);
  }

  private async fetchWithRetry(
    input: string,
    init: RequestInit | undefined,
    deadline: number,
    authenticated = false,
  ): Promise<Response> {
    for (let attempt = 1; attempt <= this.maxRequestAttempts; attempt += 1) {
      let response: Response;
      try {
        const remaining = this.remainingTime(deadline);
        response = await this.request(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(20_000, remaining)),
        });
      } catch {
        if (this.now() >= deadline) throw new MinerUOcrError("timeout");
        if (attempt === this.maxRequestAttempts) {
          throw new MinerUOcrError("service-unavailable");
        }
        await this.waitWithinDeadline(250 * 2 ** (attempt - 1), deadline);
        continue;
      }
      if (response.ok) return response;
      if (
        authenticated &&
        (response.status === 401 || response.status === 403)
      ) {
        throw new MinerUOcrError("authentication-failed");
      }
      if (response.status !== 429 && response.status < 500) {
        throw new MinerUOcrError("service-unavailable");
      }
      if (attempt === this.maxRequestAttempts) {
        throw new MinerUOcrError(
          response.status === 429 ? "rate-limited" : "service-unavailable",
        );
      }
      await this.waitWithinDeadline(250 * 2 ** (attempt - 1), deadline);
    }
    throw new MinerUOcrError("service-unavailable");
  }

  private parseEnvelope(body: unknown) {
    try {
      const envelope = responseEnvelopeSchema.parse(body);
      if (String(envelope.code) !== "0") {
        throw errorFromMinerUCode(envelope.code);
      }
    } catch (error) {
      if (error instanceof MinerUOcrError) throw error;
      throw new MinerUOcrError("service-unavailable");
    }
  }

  private async createBatch(filename: string, deadline: number) {
    const response = await this.fetchWithRetry(
      "https://mineru.net/api/v4/file-urls/batch",
      {
        method: "POST",
        headers: {
          ...this.authorizationHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          files: [{ name: filename }],
          model_version: "vlm",
        }),
      },
      deadline,
      true,
    );
    try {
      const body: unknown = await response.json();
      this.parseEnvelope(body);
      const batch = createBatchSchema.parse(body).data;
      const uploadUrl = batch.file_urls[0]!;
      this.assertAllowedHost(uploadUrl, this.allowedUploadHosts);
      return {
        batchId: batch.batch_id,
        uploadUrl,
      };
    } catch (error) {
      if (error instanceof MinerUOcrError) throw error;
      throw new MinerUOcrError("service-unavailable");
    }
  }

  private async upload(
    uploadUrl: string,
    image: Uint8Array,
    deadline: number,
  ) {
    await this.fetchWithRetry(uploadUrl, {
      method: "PUT",
      body: Buffer.from(image),
    }, deadline);
  }

  private async waitForResultZip(
    batchId: string,
    filename: string,
    deadline: number,
  ): Promise<string> {
    for (let poll = 0; poll < this.maxPolls; poll += 1) {
      const response = await this.fetchWithRetry(
        `https://mineru.net/api/v4/extract-results/batch/${encodeURIComponent(batchId)}`,
        {
          headers: this.authorizationHeaders(),
        },
        deadline,
        true,
      );
      let results: z.infer<typeof extractResultSchema>[];
      try {
        const body: unknown = await response.json();
        this.parseEnvelope(body);
        results = batchStatusSchema.parse(body).data.extract_result;
      } catch (error) {
        if (error instanceof MinerUOcrError) throw error;
        throw new MinerUOcrError("service-unavailable");
      }
      const result = results.find((item) => item.file_name === filename) ??
        results[0];
      if (result?.state === "failed") {
        throw new MinerUOcrError("parse-failed");
      }
      if (result?.state === "done") {
        if (!result.full_zip_url) throw new MinerUOcrError("parse-failed");
        this.assertAllowedHost(result.full_zip_url, this.allowedResultHosts);
        return result.full_zip_url;
      }
      if (poll < this.maxPolls - 1) {
        await this.waitWithinDeadline(this.pollIntervalMs, deadline);
      }
    }
    throw new MinerUOcrError("timeout");
  }

  private async readBoundedBytes(
    response: Response,
    limit: number,
  ): Promise<Uint8Array> {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > limit) {
      throw new MinerUOcrError("parse-failed");
    }
    if (!response.body) throw new MinerUOcrError("parse-failed");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > limit) {
        await reader.cancel();
        throw new MinerUOcrError("parse-failed");
      }
      chunks.push(value);
    }
    const result = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private extractMarkdownFromZip(zipBytes: Uint8Array): string {
    let oversizedMarkdown = false;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(zipBytes, {
        filter: (file) => {
          const isMarkdown = file.name === "full.md" ||
            file.name.endsWith("/full.md");
          if (isMarkdown && file.originalSize > this.maxMarkdownBytes) {
            oversizedMarkdown = true;
            return false;
          }
          return isMarkdown;
        },
      });
    } catch {
      throw new MinerUOcrError("parse-failed");
    }
    if (oversizedMarkdown) throw new MinerUOcrError("parse-failed");
    const entry = Object.entries(files).find(
      ([name]) => name === "full.md" || name.endsWith("/full.md"),
    );
    if (!entry) throw new MinerUOcrError("parse-failed");
    try {
      const markdown = new TextDecoder("utf-8", { fatal: true })
        .decode(entry[1])
        .trim();
      if (!markdown) throw new MinerUOcrError("parse-failed");
      return markdown;
    } catch (error) {
      if (error instanceof MinerUOcrError) throw error;
      throw new MinerUOcrError("parse-failed");
    }
  }

  async extractMarkdown(
    request: DocumentOcrRequest,
  ): Promise<DocumentOcrResult> {
    const deadline = this.now() + this.timeoutMs;
    const batch = await this.createBatch(request.filename, deadline);
    await this.upload(batch.uploadUrl, request.image, deadline);
    const resultZipUrl = await this.waitForResultZip(
      batch.batchId,
      request.filename,
      deadline,
    );
    const zipResponse = await this.fetchWithRetry(
      resultZipUrl,
      undefined,
      deadline,
    );
    const zipBytes = await this.readBoundedBytes(
      zipResponse,
      this.maxZipBytes,
    );
    return {
      markdown: this.extractMarkdownFromZip(zipBytes),
      provider: "mineru-precision-vlm",
    };
  }
}
