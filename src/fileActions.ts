import type { FilePayload } from "./bytes";
import { callBackground, warnUnlessOffline } from "./bridge";
import { currentChatTitle, expandLongMessages, readChatMessages, sameTitle } from "./dom/chat";
import {
  captureDocument,
  capturePhoto,
  listMediaMessages,
  messageIds,
  pasteFile,
  waitForSentPhoto,
  type CaptureResult,
  type PasteResult,
} from "./dom/media";
import type { CvChatReply, MediaListReply, SavedDownload } from "./messages";
import { normalizePhone } from "./phone";
import type { ChatSyncResponse } from "./shared/contract";

/**
 * File work in the WhatsApp tab, asked for by the side panel: reading the
 * client's photo or document to save as their CV, and putting a preview
 * into the chat. I press send on the preview; once I have, it's recorded.
 */

/** How long after the preview is in the chat I have to press send */
const SEND_WAIT_MS = 5 * 60_000;
/** The most messages CareerCVPro takes in one sync */
const CV_CHAT_LIMIT = 50;

export function listMedia(doc: Document): MediaListReply {
  const title = currentChatTitle(doc);
  if (!title) return { error: "Open the client's chat in WhatsApp first." };
  return { title, items: listMediaMessages(doc) };
}

/**
 * Before CV work: show every long message in full (WhatsApp hides the rest
 * behind "Read more") and send the chat on screen to CareerCVPro, so the CV
 * is written from everything the client typed.
 */
export async function readChatForCv(doc: Document, title: string): Promise<CvChatReply> {
  const open = currentChatTitle(doc);
  if (!open || !sameTitle(open, title)) {
    return { ok: false, error: "That chat isn't open any more. Open it and try again." };
  }
  await expandLongMessages(doc);
  const messages = readChatMessages(doc).slice(-CV_CHAT_LIMIT);
  await callBackground<ChatSyncResponse>({
    type: "chat-sync",
    title: open,
    phone: normalizePhone(open),
    messages,
  });
  return { ok: true, messages: messages.length };
}

export async function captureMedia(
  doc: Document,
  input: { title: string; waMessageId: string; kind: "image" | "document" },
): Promise<CaptureResult> {
  const open = currentChatTitle(doc);
  if (!open || !sameTitle(open, input.title)) {
    return { ok: false, error: "That chat isn't open any more. Open it and try again." };
  }
  if (input.kind === "image") return capturePhoto(doc, input.waMessageId);

  let downloadId: number | null = null;
  const result = await captureDocument(doc, input.waMessageId, async (since) => {
    const saved = await callBackground<SavedDownload | null>({
      type: "expect-download",
      since,
    }).catch(() => null);
    downloadId = saved?.download_id ?? null;
    return saved;
  });
  // Read from the page, so the copy in Downloads isn't needed
  if (downloadId !== null) {
    void callBackground({ type: "forget-download", downloadId }).catch(() => undefined);
  }
  return result;
}

/** The preview whose send I'm being watched for; a newer paste replaces it */
let watching: string | null = null;

export async function putFileInChat(
  doc: Document,
  input: { title: string; outboxId: string; file: FilePayload; caption: string },
): Promise<PasteResult> {
  const before = messageIds(doc);
  const result = await pasteFile(doc, input);
  const report = (status: "sent" | "failed", detail: { wa_message_id?: string; reason?: string }) =>
    callBackground({ type: "outbox-result", id: input.outboxId, result: { status, ...detail } });

  if (!result.ok) {
    void report("failed", { reason: "could_not_paste" }).catch(warnUnlessOffline);
    return result;
  }

  watching = input.outboxId;
  void waitForSentPhoto(doc, input.title, before, SEND_WAIT_MS)
    .then((id) => {
      if (watching !== input.outboxId) return;
      watching = null;
      return id ? report("sent", { wa_message_id: id }) : report("failed", { reason: "not_sent" });
    })
    .catch(warnUnlessOffline);
  return result;
}
