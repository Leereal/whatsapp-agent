import { automationBlocks } from "./automation";
import { callBackground } from "./bridge";
import {
  adSource,
  assessChat,
  assessReplyChat,
  clearComposer,
  composerText,
  currentChatTitle,
  findOurMessage,
  messagesAfter,
  openChat,
  openFailureDetails,
  pressSend,
  readMessages,
  sameTitle,
  sendFailureDetails,
  typeMessage,
  waitForSent,
  type OpenChatResult,
} from "./dom/chat";
import { runHealthCheck } from "./dom/healthCheck";
import type { UserActivity } from "./dom/userActivity";
import type {
  ClaimResponse,
  ContactSource,
  OutboxItem,
  OutboxResultRequest,
} from "./shared/contract";
import { connectionStatus, localKillSwitch, whatsappHealth } from "./storage";

/**
 * Sends one outbox message in WhatsApp Web:
 *   wait until I'm idle → claim (backend re-checks every rule) → open the
 *   chat → confirm it's a brand-new lead (pricing), or that the client's
 *   message a reply answers is still the last one → type → send → confirm
 *   the bubble → report → go back to the chat I had open.
 * Any doubt stops the send. A message that may have gone out is never
 * retried blindly: the next attempt finds it in the chat and records it as
 * sent instead of sending it again.
 */

/** I must not have touched WhatsApp Web for this long before it acts */
export const USER_IDLE_MS = 20_000;
/** After stepping back mid-send, wait for the claim to expire before retrying */
const CLAIM_EXPIRY_MS = 3 * 60_000 + 5_000;

/** The outbox reason for each way opening the chat can fail */
export const OPEN_FAILURES: Record<Exclude<OpenChatResult, "opened">, string> = {
  row_not_found: "chat_row_not_found",
  did_not_open: "chat_did_not_open",
  not_confirmed: "chat_not_confirmed",
};

export type SendOutcome =
  | { kind: "done"; status: "sent" | "skipped" | "failed" | "refused" }
  | { kind: "retry"; afterMs: number; reason: string };

const done = (status: "sent" | "skipped" | "failed" | "refused"): SendOutcome => ({
  kind: "done",
  status,
});
const retry = (afterMs: number, reason: string): SendOutcome => ({
  kind: "retry",
  afterMs,
  reason,
});

export async function automationAllowed(): Promise<boolean> {
  const [status, health, kill] = await Promise.all([
    connectionStatus.getValue(),
    whatsappHealth.getValue(),
    localKillSwitch.getValue(),
  ]);
  return automationBlocks({ status, health, localKillSwitch: kill }).length === 0;
}

export async function sendItem(
  item: OutboxItem,
  activity: UserActivity,
  doc: Document,
): Promise<SendOutcome> {
  if (!(await automationAllowed())) return retry(60_000, "automation_blocked");
  if (!activity.idleFor(USER_IDLE_MS)) return retry(15_000, "user_active");
  // The page as it is now, not as the last 30-second check saw it: the chat
  // list may be hidden (Status, Settings) or mid-redraw
  const page = runHealthCheck(doc, { startupGraceOver: true });
  if (page.pageState !== "ready" || page.failures.length > 0) {
    return retry(60_000, "page_not_ready");
  }

  const claim = await callBackground<ClaimResponse>({ type: "outbox-claim", id: item.id });
  if (!claim.go || !claim.body) {
    return claim.retry_after_seconds
      ? retry(claim.retry_after_seconds * 1000, claim.reason ?? "wait")
      : done("refused");
  }

  const body = claim.body;
  const startedAt = Date.now();
  const interrupted = () => activity.activeSince(startedAt);
  const report = (result: OutboxResultRequest) =>
    callBackground({ type: "outbox-result", id: item.id, result });
  const fail = async (reason: string) => {
    await report({ status: "failed", reason });
    return done("failed");
  };
  /** Fail, and send Sentry the page structure (no text) so the cause can be fixed */
  const failWithDetails = async (
    reason: string,
    details: Record<string, string | number | boolean>,
  ) => {
    void callBackground({ type: "report-send-failure", reason, details }).catch(() => undefined);
    return fail(reason);
  };
  const previousChat = currentChatTitle(doc);

  try {
    const opened = await openChat(doc, item.contact.title, item.contact.title);
    if (opened !== "opened") {
      return await failWithDetails(
        OPEN_FAILURES[opened],
        openFailureDetails(doc, item.contact.title),
      );
    }
    // I started using WhatsApp: step back; the claim expires and it's retried later
    if (interrupted()) return retry(CLAIM_EXPIRY_MS, "user_active");

    const messages = readMessages(doc);
    // Pricing goes to brand-new leads; everything else answers the client
    const answersClient = item.kind !== "pricing";
    // An earlier attempt sent it but couldn't confirm: record it, never send it twice.
    // A reply is only looked for after the message it answers: I may have said the same before.
    const earlier = findOurMessage(
      answersClient ? messagesAfter(messages, claim.answers_message_id) : messages,
      body,
    );
    if (earlier) {
      const source = answersClient ? null : adSource(messages);
      await report({ status: "sent", wa_message_id: earlier.id, ...(source ? { source } : {}) });
      return done("sent");
    }

    const unreadable = () => {
      const seen = new Set(messages.map((message) => message.id));
      return failWithDetails("direction_unknown", sendFailureDetails(doc, seen, body));
    };
    let source: ContactSource | null = null;
    if (answersClient) {
      const fit = assessReplyChat(messages, claim.answers_message_id ?? null);
      if (!fit.ok) {
        if (fit.reason === "no_messages_found") return await fail("no_messages_found");
        if (fit.reason === "direction_unknown") return await unreadable();
        await report({ status: "skipped", reason: fit.reason });
        return done("skipped");
      }
    } else {
      const assessment = assessChat(messages);
      if (!assessment.isNew) {
        if (assessment.reason === "no_messages_found") return await fail("no_messages_found");
        if (assessment.reason === "direction_unknown") return await unreadable();
        await report({ status: "skipped", reason: "existing_chat" });
        return done("skipped");
      }
      source = assessment.source;
    }
    // Never touch a message I'm writing
    if (composerText(doc)) return await fail("composer_not_empty");

    const before = new Set(messages.map((message) => message.id));
    if (!(await typeMessage(doc, body))) {
      clearComposer(doc);
      return await fail("could_not_type");
    }
    if (interrupted()) {
      clearComposer(doc);
      return retry(CLAIM_EXPIRY_MS, "user_active");
    }
    if (!(await pressSend(doc))) {
      clearComposer(doc);
      return await fail("send_button_not_found");
    }

    const sent = await waitForSent(doc, before, body);
    if (!sent) {
      return await failWithDetails("not_confirmed", sendFailureDetails(doc, before, body));
    }

    await report({ status: "sent", wa_message_id: sent.id, ...(source ? { source } : {}) });
    return done("sent");
  } finally {
    if (previousChat && !sameTitle(previousChat, item.contact.title) && !interrupted()) {
      await openChat(doc, previousChat, null).catch(() => null);
    }
  }
}
