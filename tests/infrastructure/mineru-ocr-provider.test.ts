import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  MinerUOcrError,
  MinerUPrecisionOcrProvider,
} from "@/infrastructure/mineru/mineru-ocr-provider";

function syntheticResultZip(markdown = "# Synthetic OCR result") {
  return zipSync({
    "synthetic/full.md": strToU8(markdown),
    "synthetic/layout.json": strToU8("{}"),
  });
}

describe("MinerU Precision OCR provider", () => {
  it("uploads with a Bearer token, polls the batch and extracts full.md in memory", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let pollCount = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/api/v4/file-urls/batch")) {
        return Response.json({
          code: 0,
          data: {
            batch_id: "batch-synthetic-1",
            file_urls: ["https://upload.example/signed-file"],
          },
        });
      }
      if (url === "https://upload.example/signed-file") {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/api/v4/extract-results/batch/batch-synthetic-1")) {
        pollCount += 1;
        return Response.json({
          code: 0,
          data: {
            batch_id: "batch-synthetic-1",
            extract_result: [{
              file_name: "portfolio-screenshot.png",
              state: pollCount === 1 ? "running" : "done",
              ...(pollCount === 1
                ? {}
                : { full_zip_url: "https://result.example/result.zip" }),
            }],
          },
        });
      }
      if (url === "https://result.example/result.zip") {
        return new Response(Buffer.from(syntheticResultZip()), { status: 200 });
      }
      return new Response(null, { status: 404 });
    };
    const provider = new MinerUPrecisionOcrProvider("synthetic-token", {
      fetch: fakeFetch,
      sleep: async () => undefined,
      maxPolls: 3,
      allowedUploadHosts: ["upload.example"],
      allowedResultHosts: ["result.example"],
    });

    await expect(provider.extractMarkdown({
      image: new Uint8Array([1, 2, 3]),
      filename: "portfolio-screenshot.png",
      mimeType: "image/png",
    })).resolves.toEqual({
      markdown: "# Synthetic OCR result",
      provider: "mineru-precision-vlm",
    });

    expect(requests.map(({ url, init }) => [init?.method ?? "GET", url])).toEqual([
      ["POST", "https://mineru.net/api/v4/file-urls/batch"],
      ["PUT", "https://upload.example/signed-file"],
      ["GET", "https://mineru.net/api/v4/extract-results/batch/batch-synthetic-1"],
      ["GET", "https://mineru.net/api/v4/extract-results/batch/batch-synthetic-1"],
      ["GET", "https://result.example/result.zip"],
    ]);
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer synthetic-token",
      "content-type": "application/json",
    });
    expect(requests[0]?.init?.body).toBe(JSON.stringify({
      files: [{ name: "portfolio-screenshot.png" }],
      model_version: "vlm",
    }));
    expect(requests[1]?.init?.headers).toBeUndefined();
    expect(requests[2]?.init?.headers).toMatchObject({
      authorization: "Bearer synthetic-token",
    });
    expect(requests[4]?.init?.headers).toBeUndefined();
  });

  it("maps invalid or expired credentials to a safe configuration error", async () => {
    const provider = new MinerUPrecisionOcrProvider("invalid-token", {
      fetch: async () => Response.json({
        code: "A0202",
        msg: "provider detail that must not be exposed",
        trace_id: "synthetic-trace",
      }),
      sleep: async () => undefined,
    });

    await expect(provider.extractMarkdown({
      image: new Uint8Array([1]),
      filename: "synthetic.png",
      mimeType: "image/png",
    })).rejects.toMatchObject({
      code: "authentication-failed",
      message: "MinerU Precision authentication failed.",
    });
  });

  it("maps Precision submission errors without exposing provider internals", async () => {
    const provider = new MinerUPrecisionOcrProvider("synthetic-token", {
      fetch: async () => Response.json({
        code: -60005,
        msg: "provider detail that must not be exposed",
      }),
      sleep: async () => undefined,
    });

    await expect(provider.extractMarkdown({
      image: new Uint8Array([1]),
      filename: "synthetic.png",
      mimeType: "image/png",
    })).rejects.toMatchObject({
      code: "file-too-large",
    });
  });

  it("distinguishes daily quota exhaustion from temporary rate limiting", async () => {
    const provider = new MinerUPrecisionOcrProvider("synthetic-token", {
      fetch: async () => Response.json({
        code: -60018,
        msg: "provider detail that must not be exposed",
      }),
      sleep: async () => undefined,
    });

    await expect(provider.extractMarkdown({
      image: new Uint8Array([1]),
      filename: "synthetic.png",
      mimeType: "image/png",
    })).rejects.toMatchObject({
      code: "daily-quota-exhausted",
      message:
        "MinerU Precision's daily parsing quota is exhausted. Try again tomorrow.",
    });
  });

  it("rejects signed upload and result URLs outside the allowlists", async () => {
    const requests: string[] = [];
    const provider = new MinerUPrecisionOcrProvider("synthetic-token", {
      fetch: async (input) => {
        requests.push(String(input));
        return Response.json({
          code: 0,
          data: {
            batch_id: "unsafe-batch",
            file_urls: ["https://127.0.0.1/private"],
          },
        });
      },
      sleep: async () => undefined,
    });

    await expect(provider.extractMarkdown({
      image: new Uint8Array([1]),
      filename: "synthetic.png",
      mimeType: "image/png",
    })).rejects.toMatchObject({
      code: "service-unavailable",
    });
    expect(requests).toEqual([
      "https://mineru.net/api/v4/file-urls/batch",
    ]);
  });

  it("rejects ZIP results without a bounded full.md", async () => {
    const provider = new MinerUPrecisionOcrProvider("synthetic-token", {
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/v4/file-urls/batch")) {
          return Response.json({
            code: 0,
            data: {
              batch_id: "large-markdown-batch",
              file_urls: ["https://upload.example/signed-file"],
            },
          });
        }
        if (url === "https://upload.example/signed-file") {
          return new Response(null, { status: 200 });
        }
        if (url.includes("/extract-results/batch/")) {
          return Response.json({
            code: 0,
            data: {
              batch_id: "large-markdown-batch",
              extract_result: [{
                file_name: "synthetic.png",
                state: "done",
                full_zip_url: "https://result.example/result.zip",
              }],
            },
          });
        }
        return new Response(
          Buffer.from(syntheticResultZip("12345")),
          { status: 200 },
        );
      },
      sleep: async () => undefined,
      maxMarkdownBytes: 4,
      allowedUploadHosts: ["upload.example"],
      allowedResultHosts: ["result.example"],
    });

    await expect(provider.extractMarkdown({
      image: new Uint8Array([1]),
      filename: "synthetic.png",
      mimeType: "image/png",
    })).rejects.toMatchObject({
      code: "parse-failed",
    });
  });

  it("uses one wall-clock deadline across creation, upload, polling and download", async () => {
    let clock = 0;
    const provider = new MinerUPrecisionOcrProvider("synthetic-token", {
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/v4/file-urls/batch")) {
          return Response.json({
            code: 0,
            data: {
              batch_id: "slow-batch",
              file_urls: ["https://upload.example/slow"],
            },
          });
        }
        if (url === "https://upload.example/slow") {
          return new Response(null, { status: 200 });
        }
        return Response.json({
          code: 0,
          data: {
            batch_id: "slow-batch",
            extract_result: [{
              file_name: "synthetic.png",
              state: "pending",
            }],
          },
        });
      },
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      now: () => clock,
      timeoutMs: 5,
      pollIntervalMs: 3,
      maxPolls: 100,
      allowedUploadHosts: ["upload.example"],
    });

    await expect(provider.extractMarkdown({
      image: new Uint8Array([1]),
      filename: "synthetic.png",
      mimeType: "image/png",
    })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("exposes a typed error class for API route mapping", () => {
    expect(new MinerUOcrError("parse-failed")).toBeInstanceOf(Error);
  });

  it("fails safely when the server token is not configured", () => {
    expect(() => new MinerUPrecisionOcrProvider("")).toThrow(
      expect.objectContaining({
        code: "not-configured",
        message: "MinerU Precision is not configured on this device.",
      }),
    );
  });
});
