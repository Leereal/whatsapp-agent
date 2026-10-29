import { callBackground } from "./bridge";
import { READ_LIMIT } from "./copilot";
import {
  currentChatTitle,
  openChat,
  openFailureDetails,
  readChatMessages,
  readMessages,
  sameTitle,
} from "./dom/chat";
import { runHealthCheck } from "./dom/healthCheck";
import type { UserActivity } from "./dom/userActivity";
import { normalizePhone } from "./phone";
import { automationAllowed, OPEN_FAILURES, USER_IDLE_MS } from "./sender";
import type { AutoReplyResponse, OutboxItem } from "./shared/contract";

/**
 * Auto-replies (Phase 3): when a client the assistant knows writes again, the
 * scan says "read". While I'm idle the reader opens that chat, reads it, and
 * sends it to CareerCVPro, which schedules a reply, queues one for me, or
 * leaves it. Then it goes back to the chat I had open. Opening a chat marks
 * it read in WhatsApp, so replies that wait for me show in the side panel.
 */

/** A chat still unread after this long is left for me; the message is old by then */
const MAX_WAIT_MS = 30 * 60_000;

export type ReadOutcome =
  | {
      kind: "done";
      result: "scheduled" | "queued" | "none" | "skipped" | "failed";
      reason?: string;
      outbox?: OutboxItem;
    }
  | { kind: "retry"; afterMs: number; reason: string };

const retry = (afterMs: number, reason: string): ReadOutcome => ({ kind: "retry", afterMs, reason });

/** The chats waiting to be read, one at a time when due */
export class ChatReader {
  private readonly due = new Map<string, { at: number; since: number }>();
  private busy = false;

  constructor(
    private readonly run: (title: string) => Promise<ReadOutcome>,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Read this chat when possible (once, however often the scan asks) */
  add(title: string): void {
    if (!this.due.has(title)) this.due.set(title, { at: this.now(), since: this.now() });
  }

  /** Forget a chat (e.g. I replied to it myself) */
  removeChat(title: string): void {
    this.due.delete(title);
  }

  get size(): number {
    return this.due.size;
  }

  /** Read the earliest due chat, if any and if nothing is running */
  async tick(): Promise<ReadOutcome | null> {
    if (this.busy) return null;
    const now = this.now();
    let next: [string, { at: number; since: number }] | null = null;
    for (const entry of this.due) {
      if (now - entry[1].since > MAX_WAIT_MS) {
        this.due.delete(entry[0]);
        continue;
      }
      if (entry[1].at <= now && (!next || entry[1].at < next[1].at)) next = entry;
    }
    if (!next) return null;

    const [title, entry] = next;
    this.busy = true;
    try {
      const outcome = await this.run(title);
      if (outcome.kind === "retry") entry.at = this.now() + outcome.afterMs;
      else this.due.delete(title);
      return outcome;
    } catch (error) {
      entry.at = this.now() + 60_000;
      this.onError(error);
      return null;
    } finally {
      this.busy = false;
    }
  }
}

/** Open a client's chat, read it and let CareerCVPro decide on a reply */
export async function readForReply(
  title: string,
  activity: UserActivity,
  doc: Document,
): Promise<ReadOutcome> {
  if (!(await automationAllowed())) return retry(60_000, "automation_blocked");
  if (!activity.idleFor(USER_IDLE_MS)) return retry(15_000, "user_active");
  const page = runHealthCheck(doc, { startupGraceOver: true });
  if (page.pageState !== "ready" || page.failures.length > 0) {
    return retry(60_000, "page_not_ready");
  }

  const previousChat = currentChatTitle(doc);
  const startedAt = Date.now();
  const interrupted = () => activity.activeSince(startedAt);
  try {
    const opened = await openChat(doc, title, title);
    if (opened !== "opened") {
      const reason = OPEN_FAILURES[opened];
      void callBackground({
        type: "report-send-failure",
        reason: `read_${reason}`,
        details: openFailureDetails(doc, title),
      }).catch(() => undefined);
      return { kind: "done", result: "failed", reason };
    }
    if (interrupted()) return retry(60_000, "user_active");

    // Only a chat whose last message is clearly theirs needs an answer
    const messages = readMessages(doc);
    const last = messages[messages.length - 1];
    if (!last || last.outgoing !== false) {
      return { kind: "done", result: "skipped", reason: last ? "nothing_to_answer" : "no_messages_found" };
    }

    const reply = await callBackground<AutoReplyResponse>({
      type: "auto-reply",
      title,
      phone: normalizePhone(title),
      messages: readChatMessages(doc).slice(-READ_LIMIT),
    });
    // The draft failed or another reply is going out right now: try again shortly
    if (reply.reason === "draft_failed" || reply.reason === "reply_in_progress") {
      return retry(120_000, reply.reason);
    }
    return {
      kind: "done",
      result: reply.action,
      ...(reply.reason ? { reason: reply.reason } : {}),
      ...(reply.outbox ? { outbox: reply.outbox } : {}),
    };
  } finally {
    if (previousChat && !sameTitle(previousChat, title) && !interrupted()) {
      await openChat(doc, previousChat, null).catch(() => null);
    }
  }
}
