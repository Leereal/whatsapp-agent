import { callBackground, warnUnlessOffline } from "./bridge";
import {
  clearComposer,
  composerText,
  currentChatTitle,
  pressSend,
  readChatMessages,
  readMessages,
  sameTitle,
  typeMessage,
  waitForSent,
} from "./dom/chat";
import type { InsertReply, OpenChatReply } from "./messages";
import { normalizePhone } from "./phone";
import type { ChatSyncResponse } from "./shared/contract";
import { openChatState } from "./storage";

/**
 * Copilot support inside WhatsApp Web:
 * - keeps the side panel told which chat is open (and its contact and order,
 *   for chats the assistant knows), copying their new messages to CareerCVPro;
 * - reads the open chat when I ask for a draft;
 * - puts a draft into the message box, and sends it only when I clicked Send.
 * It never touches text I've typed, and never writes into another chat.
 */

/** Messages read for syncing and drafting */
const READ_LIMIT = 30;
/** A chat that wasn't a client's is asked about again after this (drafting adds it) */
const UNKNOWN_RECHECK_MS = 60_000;

export function readOpenChat(doc: Document): OpenChatReply {
  const title = currentChatTitle(doc);
  if (!title) return { error: "Open the client's chat in WhatsApp first." };
  return {
    title,
    phone: normalizePhone(title),
    messages: readChatMessages(doc).slice(-READ_LIMIT),
  };
}

/**
 * Type a draft into the open chat. `send` presses send and waits for the
 * message to appear; otherwise I review it in WhatsApp and press Enter.
 */
export async function insertDraft(
  doc: Document,
  input: { title: string; text: string; send: boolean },
): Promise<InsertReply> {
  const open = currentChatTitle(doc);
  if (!open || !sameTitle(open, input.title)) {
    return { ok: false, error: "That chat isn't open any more. Open it and try again." };
  }
  if (composerText(doc)) {
    return { ok: false, error: "You have a message typed in this chat. Send or clear it first." };
  }
  if (!(await typeMessage(doc, input.text))) {
    clearComposer(doc);
    return { ok: false, error: "Couldn't type into the message box." };
  }
  if (!input.send) return { ok: true, sent: false };

  const before = new Set(readMessages(doc).map((message) => message.id));
  if (!(await pressSend(doc))) {
    return { ok: false, error: "Couldn't find the send button; the text is in the message box." };
  }
  const sent = await waitForSent(doc, before, input.text);
  if (!sent) return { ok: false, error: "Couldn't confirm it was sent; check the chat." };

  // A reply I chose to send: the chat is mine, so automation steps back
  void callBackground({ type: "manual-reply", title: open, phone: normalizePhone(open) }).catch(
    () => undefined,
  );
  return { ok: true, sent: true };
}

/**
 * Watches which chat is open. When it changes, or a new message arrives,
 * asks CareerCVPro whether it's a client chat; only then are its messages
 * sent, so personal chats never leave the browser.
 */
export class OpenChatWatcher {
  private lastKey = "";
  /** Title → whether CareerCVPro knows the chat, and when it said so */
  private readonly known = new Map<string, { known: boolean; at: number }>();
  private running = false;

  constructor(
    private readonly doc: Document,
    private readonly canSync: () => Promise<boolean>,
  ) {}

  /** Call often; it only does work when the chat or its last message changed */
  async check(): Promise<void> {
    if (this.running) return;
    const title = currentChatTitle(this.doc);
    const messages = title ? readChatMessages(this.doc).slice(-READ_LIMIT) : [];
    const key = `${title ?? ""}|${messages[messages.length - 1]?.wa_message_id ?? ""}`;
    const cached = title ? this.known.get(title) : undefined;
    const stale = cached?.known === false && Date.now() - cached.at > UNKNOWN_RECHECK_MS;
    if (key === this.lastKey && !stale) return;

    this.running = true;
    try {
      if (!title) {
        await openChatState.setValue(null);
        this.lastKey = key;
        return;
      }
      if (!(await this.canSync())) return;

      const phone = normalizePhone(title);
      // Unknown chats are first checked without their messages
      let reply = await callBackground<ChatSyncResponse>({
        type: "chat-sync",
        title,
        phone,
        messages: cached?.known ? messages : [],
      });
      if (reply.known && !cached?.known) {
        reply = await callBackground<ChatSyncResponse>({ type: "chat-sync", title, phone, messages });
      }
      this.known.set(title, { known: reply.known, at: Date.now() });

      await openChatState.setValue({
        title,
        phone,
        known: reply.known,
        chat: reply.chat,
        checkedAt: new Date().toISOString(),
      });
      this.lastKey = key;
    } catch (error) {
      // Offline or not set up: the next check retries
      warnUnlessOffline(error);
    } finally {
      this.running = false;
    }
  }

}
