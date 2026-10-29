import { normalizePhone } from "../phone";
import { query, queryAll, queryInside, resolve } from "../selectors";
import type { ChatMessageInput, ContactSource } from "../shared/contract";
import { readChatRows } from "./chatList";
import { describeInteractive, describePath } from "./describe";
import { maskDataId } from "./snapshot";
import {
  clearText,
  clickLikeUser,
  elementText,
  insertText,
  pressKey,
  sleep,
  waitFor,
} from "./interact";

/**
 * Working with one chat: opening it, reading its messages, and typing and
 * sending in it. Every step checks its result; nothing is assumed.
 */

export interface ChatMessage {
  /** data-id: WhatsApp's message id ("3EB0…"; older versions "false_<chat>_3EB0…") */
  id: string;
  /** true = I sent it, false = they did, null = can't tell (never guessed) */
  outgoing: boolean | null;
  text: string;
}

const SEARCH_TIMEOUT_MS = 8_000;
/** How long one way of opening a chat gets before the next is tried */
const ATTEMPT_TIMEOUT_MS = 2_500;
const SENT_TIMEOUT_MS = 12_000;

/** Without invisible direction marks (WhatsApp wraps numbers in them) or extra spaces */
function cleanTitle(text: string): string {
  return text
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What identifies a chat by its title: a phone number's digits, since
 * WhatsApp formats a number differently in different places; otherwise the
 * name, ignoring case.
 */
export function titleKey(title: string): string {
  const clean = cleanTitle(title);
  return normalizePhone(clean) ?? clean.toLowerCase();
}

export function sameTitle(a: string, b: string): boolean {
  return titleKey(a) === titleKey(b);
}

export function currentChatTitle(root: ParentNode = document): string | null {
  const title = query("conversationTitle", root);
  return title ? cleanTitle(title.getAttribute("title") || elementText(title)) || null : null;
}

/**
 * Is this chat the one open on the right? Looks for the title anywhere in
 * the chat's header, so it doesn't depend on which element holds the name.
 */
export function isChatOpen(root: ParentNode, title: string): boolean {
  const header = query("conversationHeader", root);
  if (!header) return false;
  const wanted = titleKey(title);
  return Array.from(header.querySelectorAll("*")).some((element) => {
    const label = element.getAttribute("title");
    if (label && titleKey(label) === wanted) return true;
    return element.childElementCount === 0 && titleKey(elementText(element)) === wanted;
  });
}

function findRow(root: ParentNode, title: string): Element | null {
  return readChatRows(root, []).find((row) => sameTitle(row.title, title))?.element ?? null;
}

/** The innermost element under the row's centre, if it belongs to the row */
function elementAtCentre(row: Element): Element | null {
  const box = row.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const hit = row.ownerDocument.elementFromPoint?.(
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  return hit && row.contains(hit) ? hit : null;
}

/** Where a person would click: the name, the middle of the row, then its wrappers */
function clickTargets(row: Element): Element[] {
  const targets = [
    queryInside("chatRowTitle", row),
    elementAtCentre(row),
    row.firstElementChild,
    row,
  ];
  return targets.filter(
    (target, index): target is Element => target !== null && targets.indexOf(target) === index,
  );
}

async function openRow(root: ParentNode, row: Element, title: string): Promise<boolean> {
  const opened = () => isChatOpen(root, title);
  for (const target of clickTargets(row)) {
    clickLikeUser(target);
    if (await waitFor(opened, ATTEMPT_TIMEOUT_MS)) return true;
  }
  // Last resort: rows take keyboard focus and open on Enter
  const focusable = row.matches("[tabindex]") ? row : row.querySelector("[tabindex]");
  if (focusable instanceof HTMLElement) {
    focusable.focus();
    pressKey(focusable, "Enter");
    if (await waitFor(opened, ATTEMPT_TIMEOUT_MS)) return true;
  }
  return false;
}

/** Anything but "opened" means the message must not be sent */
export type OpenChatResult = "opened" | "row_not_found" | "did_not_open" | "not_confirmed";

/** After clicking: did nothing happen, or did a chat open that can't be confirmed as theirs? */
function whyNotOpened(root: ParentNode, before: string | null): OpenChatResult {
  const now = currentChatTitle(root);
  const unchanged =
    now === null ? !query("conversationHeader", root) : before !== null && sameTitle(now, before);
  return unchanged ? "did_not_open" : "not_confirmed";
}

/**
 * Open a chat by its title (a phone number for new leads). Uses the visible
 * row when there is one, otherwise the search box, which is cleared after.
 */
export async function openChat(
  root: ParentNode,
  title: string,
  searchText: string | null,
): Promise<OpenChatResult> {
  if (isChatOpen(root, title)) return "opened";
  const before = currentChatTitle(root);

  const visible = findRow(root, title);
  if (visible) {
    return (await openRow(root, visible, title)) ? "opened" : whyNotOpened(root, before);
  }
  if (!searchText) return "row_not_found";

  const search = query<HTMLElement>("searchBox", root);
  if (!search) return "row_not_found";

  try {
    insertText(search, searchText);
    const found = await waitFor(() => findRow(root, title), SEARCH_TIMEOUT_MS);
    if (!found) return "row_not_found";
    return (await openRow(root, found, title)) ? "opened" : whyNotOpened(root, before);
  } finally {
    clearText(search);
    pressKey(search, "Escape");
    await sleep(300);
  }
}

/**
 * The page's structure around a chat that wouldn't open, for the error
 * report: element types and roles only, no names, numbers or message text.
 */
export function openFailureDetails(
  root: ParentNode,
  title: string,
): Record<string, string | number | boolean> {
  const row = findRow(root, title);
  const name = row ? queryInside("chatRowTitle", row) : null;
  const header = query("conversationHeader", root);
  const above = row?.parentElement?.parentElement ?? row?.parentElement ?? null;
  return {
    row_found: row !== null,
    row_candidate: resolve("chatRow", root).candidateIndex,
    row_above: row && above ? describePath(above, row) : "",
    row_to_name: row && name ? describePath(row, name) : "",
    row_interactive: row ? describeInteractive(row) : "",
    panel_candidate: resolve("conversationPanel", root).candidateIndex,
    header_found: header !== null,
    header_title_candidate: resolve("conversationTitle", root).candidateIndex,
    header_titles: header ? header.querySelectorAll("[title]").length : 0,
  };
}

/**
 * Every sign of who sent a message: true = me, false = them. WhatsApp's
 * message ids used to say; now a hidden "You:" / "<their name>:" label,
 * delivery ticks (mine only) and the bubble's tail do.
 */
function directionSignals(element: Element): boolean[] {
  const signals: boolean[] = [];
  const id = element.getAttribute("data-id") ?? "";
  if (id.startsWith("true_")) signals.push(true);
  if (id.startsWith("false_")) signals.push(false);
  const sender = queryInside("messageSender", element)?.getAttribute("aria-label")?.trim();
  if (sender) signals.push(sender === "You:");
  if (queryInside("messageStatus", element)) signals.push(true);
  if (queryInside("messageTailOut", element)) signals.push(true);
  if (queryInside("messageTailIn", element)) signals.push(false);
  return signals;
}

/** Who sent it, only when every sign agrees; no signs or mixed signs give null */
export function messageDirection(element: Element): boolean | null {
  const signals = new Set(directionSignals(element));
  return signals.size === 1 ? signals.has(true) : null;
}

/** Messages in the open chat, without WhatsApp's notices (encryption, "not a contact") */
export function readMessages(root: ParentNode = document): ChatMessage[] {
  return queryAll("messageRow", root)
    .filter((element) => !queryInside("systemMessage", element))
    .map((element) => ({
      id: element.getAttribute("data-id") ?? "",
      outgoing: messageDirection(element),
      text: elementText(element),
    }))
    .filter((message) => message.id !== "");
}

/** Text as written: emoji (drawn as images) become their characters, <br> a line break */
function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.tagName === "IMG") {
    return node.getAttribute("data-plain-text") ?? node.getAttribute("alt") ?? "";
  }
  if (node.tagName === "BR") return "\n";
  return Array.from(node.childNodes).map(plainText).join("");
}

/**
 * When a message was sent, from data-pre-plain-text
 * ("[10:15, 28/10/2026] Thandi M: "). WhatsApp writes the date in the
 * computer's format: four digits first means year first, a second number
 * above 12 means month first; otherwise day first, as in South Africa.
 * Null when it can't be read.
 */
export function parseMessageTime(value: string | null): string | null {
  const match =
    /^\[(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\.?)?,\s*(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})\]/i.exec(
      value ?? "",
    );
  if (!match) return null;
  const [, h, min, meridiem, a, b, c] = match;
  const [first, second, third] = [Number(a), Number(b), Number(c)];

  let year: number, month: number, day: number;
  if (first > 31) [year, month, day] = [first, second, third];
  else if (first <= 12 && second > 12) [month, day, year] = [first, second, third];
  else [day, month, year] = [first, second, third];
  if (year < 100) year += 2000;

  let hour = Number(h);
  if (meridiem?.toLowerCase() === "p" && hour < 12) hour += 12;
  if (meridiem?.toLowerCase() === "a" && hour === 12) hour = 0;

  const date = new Date(year, month - 1, day, hour, Number(min));
  return Number.isNaN(date.getTime()) || date.getMonth() !== month - 1
    ? null
    : date.toISOString();
}

/**
 * The open chat's messages as the backend stores them, oldest first.
 * Messages whose sender can't be told are left out rather than guessed.
 */
export function readChatMessages(root: ParentNode = document): ChatMessageInput[] {
  return queryAll("messageRow", root)
    .filter((element) => !queryInside("systemMessage", element))
    .flatMap((element): ChatMessageInput[] => {
      const id = element.getAttribute("data-id");
      const outgoing = messageDirection(element);
      if (!id || outgoing === null) return [];

      const textElement = queryInside("messageText", element);
      const text = textElement
        ? plainText(textElement)
            .replace(/[‎‏]/g, "")
            .trim()
        : "";
      return [
        {
          wa_message_id: id,
          direction: outgoing ? "out" : "in",
          text,
          media_type: queryInside("messageImage", element) ? "image" : "none",
          sent_at: parseMessageTime(
            queryInside("messageMeta", element)?.getAttribute("data-pre-plain-text") ?? null,
          ),
        },
      ];
    });
}

/** The greeting Meta sends for a Click-to-WhatsApp ad; it doesn't mean I've replied */
export function isAdGreeting(message: ChatMessage): boolean {
  return (
    message.outgoing === true &&
    (/automated greeting/i.test(message.text) || /(facebook|instagram) ad/i.test(message.text))
  );
}

export function adSource(messages: ChatMessage[]): ContactSource | null {
  const greeting = messages.find(isAdGreeting);
  if (!greeting) return null;
  return /instagram/i.test(greeting.text) ? "ig_ad" : "fb_ad";
}

export type ChatAssessment =
  | { isNew: true; source: ContactSource | null }
  | {
      isNew: false;
      reason: "no_messages_found" | "direction_unknown" | "last_message_is_mine" | "existing_chat";
    };

/**
 * Is the open chat a brand-new lead? Only when it has messages, the last one
 * is from them, and nothing from me except the ad's automated greeting.
 * A message I clearly sent settles it (an existing chat, skipped) even if
 * older messages can't be read; otherwise a message whose sender can't be
 * told might be mine, so it rules the chat out.
 */
export function assessChat(messages: ChatMessage[]): ChatAssessment {
  const last = messages[messages.length - 1];
  if (!last) return { isNew: false, reason: "no_messages_found" };
  if (last.outgoing === true) return { isNew: false, reason: "last_message_is_mine" };
  if (messages.some((message) => message.outgoing === true && !isAdGreeting(message))) {
    return { isNew: false, reason: "existing_chat" };
  }
  if (messages.some((message) => message.outgoing === null)) {
    return { isNew: false, reason: "direction_unknown" };
  }
  return { isNew: true, source: adSource(messages) };
}

export type ReplyAssessment =
  | { ok: true }
  | {
      ok: false;
      reason: "no_messages_found" | "direction_unknown" | "already_answered" | "chat_moved_on";
    };

/**
 * May a reply the assistant wrote go into the open chat? Only while the
 * client's message it answers is still the chat's last message: once either
 * of us wrote since, the reply no longer fits.
 */
export function assessReplyChat(
  messages: ChatMessage[],
  answersMessageId: string | null,
): ReplyAssessment {
  const last = messages[messages.length - 1];
  if (!last) return { ok: false, reason: "no_messages_found" };
  if (last.outgoing === null) return { ok: false, reason: "direction_unknown" };
  if (last.outgoing) return { ok: false, reason: "already_answered" };
  if (answersMessageId && last.id !== answersMessageId) return { ok: false, reason: "chat_moved_on" };
  return { ok: true };
}

/** The messages after the one with this id; none when it isn't on screen */
export function messagesAfter(messages: ChatMessage[], id: string | null | undefined): ChatMessage[] {
  const index = id ? messages.findIndex((message) => message.id === id) : -1;
  return index >= 0 ? messages.slice(index + 1) : [];
}

export function composer(root: ParentNode = document): HTMLElement | null {
  return query<HTMLElement>("composer", root);
}

export function composerText(root: ParentNode = document): string {
  return elementText(composer(root));
}

/**
 * Letters and digits only, lower case. WhatsApp draws emoji as images and
 * hides *bold* markers, so on-screen text only matches on this core.
 */
export function comparable(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/** The start of a message, to recognise it in the composer and in a bubble */
export function snippet(body: string): string {
  return comparable(body).slice(0, 30).trim();
}

export async function typeMessage(root: ParentNode, body: string): Promise<boolean> {
  const box = composer(root);
  if (!box) return false;
  insertText(box, body);
  const expected = snippet(body);
  return Boolean(await waitFor(() => comparable(composerText(root)).includes(expected), 3_000));
}

export function clearComposer(root: ParentNode = document): void {
  const box = composer(root);
  if (box) clearText(box);
}

export async function pressSend(root: ParentNode): Promise<boolean> {
  const panel = resolve("conversationPanel", root).elements[0] ?? root;
  const button = await waitFor(() => queryInside("sendButton", panel), 3_000);
  if (!button) return false;
  clickLikeUser(button.closest("button") ?? button);
  return true;
}

/** A message in the chat that starts like ours, e.g. one an earlier attempt sent */
export function findOurMessage(messages: ChatMessage[], body: string): ChatMessage | null {
  const expected = snippet(body);
  return (
    messages.find(
      // One they sent (e.g. quoting our pricing back) doesn't count
      (message) => message.outgoing !== false && comparable(message.text).includes(expected),
    ) ?? null
  );
}

/**
 * Wait for our message to appear as a new bubble; returns it. Matched on
 * its words: our text appearing right after we pressed send is ours even
 * if its direction can't be read yet.
 */
export async function waitForSent(
  root: ParentNode,
  before: Set<string>,
  body: string,
): Promise<ChatMessage | null> {
  return waitFor(
    () =>
      findOurMessage(
        readMessages(root).filter((message) => !before.has(message.id)),
        body,
      ),
    SENT_TIMEOUT_MS,
    300,
  );
}

/** "true_00000@c.us_3EB0F1" → "true_0@c.us_X": the id's format without its digits or letters */
const idShape = (id: string) => maskDataId(id).replace(/0+/g, "0").replace(/X+/g, "X");

/** "out,out" / "in" / "none": the direction signs on one message */
const signalSummary = (element: Element) =>
  directionSignals(element)
    .map((outgoing) => (outgoing ? "out" : "in"))
    .join(",") || "none";

/**
 * The open chat's state when a send stopped (unconfirmed, or a sender that
 * can't be told), for the error report: counts, id formats and direction
 * signs only, no names, numbers or message text.
 */
export function sendFailureDetails(
  root: ParentNode,
  before: Set<string>,
  body: string,
): Record<string, string | number | boolean> {
  const messages = readMessages(root);
  const fresh = messages.filter((message) => !before.has(message.id));
  const last = queryAll("messageRow", root)
    .filter((element) => !queryInside("systemMessage", element))
    .slice(-3);
  return {
    messages_before: before.size,
    messages_now: messages.length,
    new_messages: fresh.length,
    new_outgoing: fresh.filter((message) => message.outgoing === true).length,
    new_with_text: fresh.filter((message) => message.text !== "").length,
    outgoing_total: messages.filter((message) => message.outgoing === true).length,
    direction_unknown: messages.filter((message) => message.outgoing === null).length,
    // What the unreadable ones are, to learn which signs they lack
    unknown_with_text: messages.filter((message) => message.outgoing === null && message.text !== "")
      .length,
    unknown_with_image: queryAll("messageRow", root).filter(
      (element) =>
        !queryInside("systemMessage", element) &&
        messageDirection(element) === null &&
        Boolean(queryInside("messageImage", element)),
    ).length,
    our_text_found: findOurMessage(messages, body) !== null,
    last_ids: last.map((element) => idShape(element.getAttribute("data-id") ?? "")).join(", "),
    last_signals: last.map(signalSummary).join(" | "),
    composer_empty: composerText(root) === "",
  };
}
