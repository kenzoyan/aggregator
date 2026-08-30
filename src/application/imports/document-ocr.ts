export interface DocumentOcrRequest {
  image: Uint8Array;
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

export interface DocumentOcrResult {
  markdown: string;
  provider: string;
}

export interface DocumentOcrProvider {
  extractMarkdown(request: DocumentOcrRequest): Promise<DocumentOcrResult>;
}
