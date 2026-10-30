import { base64ToBytes, bytesToBase64, mimeFor, type FilePayload } from "../bytes";
import { query, queryInside, resolve } from "../selectors";
import {
  composer,
  composerText,
  currentChatTitle,
  messageDirections,
  messageRows,
  parseMessageTime,
  sameTitle,
} from "./chat";
import { clickLikeUser, insertText, pressKey, sleep, waitFor } from "./interact";

/**
 * Files in the open chat: the photos and documents a client sent (to save
 * as their CV), and putting a preview image into the chat for me to send.
 * The extension never presses send on a file; I do.
 */

export interface MediaMessage {
  wa_message_id: string;
  kind: "image" | "document";
  /** The document's name, when WhatsApp shows one */
  filename: string | null;
  sent_at: string | null;
}

/** How many of the client's latest files the side panel offers */
const MEDIA_LIMIT = 8;
/** A photo narrower than this is WhatsApp's blurred thumbnail, not the photo itself */
const MIN_PHOTO_WIDTH = 400;
const EDITOR_TIMEOUT_MS = 6_000;

/** 'Download "CV 2026.pdf"' → "CV 2026.pdf" */
export function filenameFromTitle(title: string | null | undefined): string | null {
  const match = /^Download\s+["“]?(.+?)["”]?\s*$/i.exec((title ?? "").trim());
  return match?.[1]?.trim() || null;
}

function rowById(root: ParentNode, id: string): Element | null {
  return messageRows(root).find((element) => element.getAttribute("data-id") === id) ?? null;
}

/** The kind of file a message carries, if any */
export function mediaKind(element: Element): "image" | "document" | null {
  if (queryInside("messageDocument", element)) return "document";
  if (queryInside("messageImage", element)) return "image";
  return null;
}

/** Photos and documents the client sent, newest last; mine and unreadable ones are left out */
export function listMediaMessages(root: ParentNode = document): MediaMessage[] {
  const rows = messageRows(root);
  const directions = messageDirections(rows, root);
  return rows
    .flatMap((element, index): MediaMessage[] => {
      const id = element.getAttribute("data-id");
      const kind = mediaKind(element);
      if (!id || !kind || directions[index] !== false) return [];
      const download = queryInside("messageDocument", element);
      return [
        {
          wa_message_id: id,
          kind,
          filename: kind === "document" ? filenameFromTitle(download?.getAttribute("title")) : null,
          sent_at: parseMessageTime(
            queryInside("messageMeta", element)?.getAttribute("data-pre-plain-text") ?? null,
          ),
        },
      ];
    })
    .slice(-MEDIA_LIMIT);
}

export type CaptureResult = { ok: true; file: FilePayload } | { ok: false; error: string };

const fail = (error: string): CaptureResult => ({ ok: false, error });

async function blobPayload(blob: Blob, filename: string): Promise<FilePayload> {
  return {
    base64: bytesToBase64(await blob.arrayBuffer()),
    mime: mimeFor(filename, blob.type),
    filename,
  };
}

/** The photo in a message, read from the page (WhatsApp shows it from a blob: URL) */
export async function capturePhoto(root: ParentNode, id: string): Promise<CaptureResult> {
  const row = rowById(root, id);
  if (!row) return fail("That message isn't on screen any more. Scroll to it and try again.");
  const images = Array.from(row.querySelectorAll<HTMLImageElement>('img[src^="blob:"]'));
  const photo = images.sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
  if (!photo)
    return fail("This photo hasn't downloaded in WhatsApp yet. Click it once, then try again.");
  if (photo.naturalWidth > 0 && photo.naturalWidth < MIN_PHOTO_WIDTH) {
    return fail(
      "Only a small preview of this photo is loaded. Click it in WhatsApp, then try again.",
    );
  }
  try {
    const blob = await (await fetch(photo.src)).blob();
    return {
      ok: true,
      file: await blobPayload(blob, `cv-photo.${blob.type.split("/")[1] || "jpg"}`),
    };
  } catch {
    return fail("Couldn't read the photo from WhatsApp. Download it and use Upload instead.");
  }
}

/**
 * The document in a message. Clicking its download control makes WhatsApp
 * save it; the service worker sees that download (`waitForDownload`, given
 * when the click happened) and hands back its blob: URL, which this page can
 * read.
 */
export async function captureDocument(
  root: ParentNode,
  id: string,
  waitForDownload: (since: number) => Promise<{ url: string; filename: string | null } | null>,
): Promise<CaptureResult> {
  const row = rowById(root, id);
  const control = row ? queryInside("messageDocument", row) : null;
  if (!row || !control)
    return fail("That document isn't on screen any more. Scroll to it and try again.");
  const name = filenameFromTitle(control.getAttribute("title"));

  const since = Date.now() - 100;
  clickLikeUser(control.closest('[role="button"]') ?? control);
  const saved = await waitForDownload(since);
  if (!saved) {
    return fail(
      "WhatsApp didn't download the document. Download it yourself and use Upload instead.",
    );
  }
  try {
    const blob = await (await fetch(saved.url)).blob();
    return { ok: true, file: await blobPayload(blob, name ?? saved.filename ?? "client-cv.pdf") };
  } catch {
    return fail("Couldn't read the document. It's in your Downloads folder: use Upload instead.");
  }
}

export type PasteResult = { ok: true; captioned: boolean } | { ok: false; error: string };

const toFile = (payload: FilePayload) =>
  new File([base64ToBytes(payload.base64)], payload.filename, { type: payload.mime });

const editorOpen = (doc: Document) => () => query<HTMLElement>("mediaCaption", doc);

/** Paste the file into the message box, as if I'd pasted a copied image */
async function pasteIntoComposer(doc: Document, file: File): Promise<HTMLElement | null> {
  const box = composer(doc);
  if (!box) return null;
  box.focus();
  const data = new DataTransfer();
  data.items.add(file);
  box.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
  );
  return waitFor(editorOpen(doc), EDITOR_TIMEOUT_MS);
}

/** The attach menu's photo input, as if I'd picked the file there */
async function attachThroughMenu(doc: Document, file: File): Promise<HTMLElement | null> {
  const panel = resolve("conversationPanel", doc).elements[0] ?? doc;
  const attach = queryInside("attachButton", panel);
  if (!attach) return null;
  clickLikeUser(attach.closest("button") ?? attach);
  const input = await waitFor(() => query<HTMLInputElement>("attachImageInput", doc), 3_000);
  if (!input) {
    pressKey(doc.body, "Escape");
    return null;
  }
  const data = new DataTransfer();
  data.items.add(file);
  input.files = data.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return waitFor(editorOpen(doc), EDITOR_TIMEOUT_MS);
}

/**
 * Put a file and its caption into the open chat, ready for me to press send.
 * Only in the chat it's meant for, and never over a message I'm typing.
 */
export async function pasteFile(
  doc: Document,
  input: { title: string; file: FilePayload; caption: string },
): Promise<PasteResult> {
  const open = currentChatTitle(doc);
  if (!open || !sameTitle(open, input.title)) {
    return { ok: false, error: "Open the client's chat in WhatsApp first." };
  }
  if (composerText(doc)) {
    return { ok: false, error: "You have a message typed in this chat. Send or clear it first." };
  }

  const file = toFile(input.file);
  const caption = (await pasteIntoComposer(doc, file)) ?? (await attachThroughMenu(doc, file));
  if (!caption) {
    return {
      ok: false,
      error: "WhatsApp didn't open the photo editor. Drag the preview into the chat instead.",
    };
  }
  if (!input.caption.trim()) return { ok: true, captioned: true };

  insertText(caption, input.caption);
  const expected = input.caption.replace(/\s+/g, " ").trim().slice(0, 20);
  const captioned = Boolean(
    await waitFor(() => (caption.textContent ?? "").replace(/\s+/g, " ").includes(expected), 2_000),
  );
  return { ok: true, captioned };
}

/** Message ids in the open chat right now */
export function messageIds(root: ParentNode = document): Set<string> {
  return new Set(messageRows(root).map((element) => element.getAttribute("data-id") ?? ""));
}

/**
 * Wait for me to send the photo: a new message of mine with a photo in the
 * chat. Returns its id, or null if none appeared in time.
 */
export async function waitForSentPhoto(
  doc: Document,
  title: string,
  before: Set<string>,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = currentChatTitle(doc);
    if (open && sameTitle(open, title)) {
      const rows = messageRows(doc);
      const directions = messageDirections(rows, doc);
      const sent = rows.find((element, index) => {
        const id = element.getAttribute("data-id");
        return (
          id &&
          !before.has(id) &&
          directions[index] === true &&
          Boolean(queryInside("messageImage", element))
        );
      });
      if (sent) return sent.getAttribute("data-id");
    }
    await sleep(1_000);
  }
  return null;
}
