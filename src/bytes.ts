/**
 * Files cross between the WhatsApp tab, the side panel and the service worker
 * as base64: Chrome's extension messages carry JSON only.
 */

const CHUNK = 0x8000;

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let start = 0; start < view.length; start += CHUNK) {
    binary += String.fromCharCode(...view.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A file in transit between parts of the extension */
export interface FilePayload {
  base64: string;
  mime: string;
  filename: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** The file's type: what the browser says, or its extension when the browser doesn't know */
export function mimeFor(filename: string, reported: string | null | undefined): string {
  const clean = (reported ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (clean && clean !== "application/octet-stream") return clean;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? (clean || "application/octet-stream");
}
