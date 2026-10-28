/**
 * Every WhatsApp Web selector lives in this file.
 *
 * WhatsApp changes its page without notice, so each element has several
 * candidates, tried in order: aria-label / role / data-* attributes first,
 * structure last, class names never. The health check (dom/healthCheck.ts)
 * runs these against the live page and turns automation off when a required
 * one stops matching, so nothing is ever clicked blindly.
 *
 * aria-labels are in English: WhatsApp Web must be set to English.
 */

export type SelectorKey =
  | "loginQrCode"
  | "chatList"
  | "chatRow"
  | "chatRowTitle"
  | "unreadBadge"
  | "searchBox"
  | "conversationPanel"
  | "conversationTitle"
  | "messageRow"
  | "messageMeta"
  | "composer"
  | "sendButton";

export interface SelectorDef {
  description: string;
  candidates: readonly string[];
  /**
   * Where the health check looks:
   * - "app": whenever WhatsApp Web is logged in
   * - "chat": only while a chat is open
   * - "action": never; the element only exists mid-action (e.g. the send
   *   button appears after typing) and is checked right before it is used
   */
  scope: "app" | "chat" | "action";
  /** Search inside the first match of this selector instead of the whole page */
  within?: SelectorKey;
  /** May legitimately be absent (e.g. no unread chats), so never a failure */
  optional?: boolean;
}

export const SELECTORS: Readonly<Record<SelectorKey, SelectorDef>> = {
  loginQrCode: {
    description: "QR code shown when WhatsApp Web is logged out",
    candidates: [
      'canvas[aria-label*="QR"]',
      'canvas[aria-label*="Scan"]',
      "div[data-ref] canvas",
      '[data-testid="qrcode"]',
    ],
    scope: "app",
    optional: true,
  },
  chatList: {
    description: "The list of chats on the left",
    candidates: ['div[aria-label="Chat list"]', '#pane-side [role="grid"]', "#pane-side"],
    scope: "app",
  },
  chatRow: {
    description: "One chat in the chat list",
    candidates: ['[role="row"]', '[role="listitem"]'],
    scope: "app",
    within: "chatList",
  },
  chatRowTitle: {
    description: "Contact name or number in a chat row",
    candidates: ['span[title][dir="auto"]', "span[title]", "[title]"],
    scope: "app",
    within: "chatRow",
  },
  unreadBadge: {
    description: "Unread-count badge on a chat row",
    candidates: ['span[aria-label*="unread message"]', '[aria-label*="unread"]'],
    scope: "app",
    within: "chatList",
    optional: true,
  },
  searchBox: {
    description: "Search box above the chat list",
    candidates: [
      '#side [contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-label*="Search"]',
      'input[aria-label*="Search"]',
      '#side input[role="textbox"]',
    ],
    scope: "app",
  },
  conversationPanel: {
    description: "The open chat on the right",
    candidates: ["#main", '[data-testid="conversation-panel-wrapper"]'],
    scope: "chat",
  },
  conversationTitle: {
    description: "Contact name or number in the open chat's header",
    candidates: ["header span[title]", 'header [dir="auto"][title]', 'header span[dir="auto"]'],
    scope: "chat",
    within: "conversationPanel",
  },
  messageRow: {
    description: "A message in the open chat (data-id holds the chat and message ids)",
    candidates: ['[role="row"] [data-id]', 'div[data-id*="@"]', "[data-id]"],
    scope: "chat",
    within: "conversationPanel",
  },
  messageMeta: {
    description: "Time and author of a text message ([HH:MM, DD/MM/YYYY] Name: )",
    candidates: ["[data-pre-plain-text]"],
    scope: "chat",
    within: "conversationPanel",
    // A chat can contain only media
    optional: true,
  },
  composer: {
    description: "Message box at the bottom of the open chat",
    candidates: [
      'footer div[contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]',
      'div[contenteditable="true"][aria-placeholder*="message"]',
      'div[contenteditable="true"][aria-label*="message"]',
    ],
    scope: "chat",
    within: "conversationPanel",
  },
  sendButton: {
    description: "Send button (appears once the message box has text)",
    candidates: [
      'button[aria-label="Send"]',
      'span[data-icon="send"]',
      'span[data-icon="wds-ic-send-filled"]',
    ],
    scope: "action",
    within: "conversationPanel",
  },
};

export interface Resolved<T extends Element = Element> {
  elements: T[];
  /** Index of the candidate that matched, or -1; a non-zero index is early drift */
  candidateIndex: number;
}

function rootFor(key: SelectorKey, root: ParentNode): ParentNode | null {
  const within = SELECTORS[key].within;
  if (!within) return root;
  return resolve(within, root).elements[0] ?? null;
}

/** All matches of the first candidate that matches anything */
export function resolve<T extends Element = Element>(
  key: SelectorKey,
  root: ParentNode = document,
): Resolved<T> {
  const scopeRoot = rootFor(key, root);
  if (!scopeRoot) return { elements: [], candidateIndex: -1 };

  let candidateIndex = 0;
  for (const candidate of SELECTORS[key].candidates) {
    const elements = Array.from(scopeRoot.querySelectorAll(candidate)) as T[];
    if (elements.length > 0) return { elements, candidateIndex };
    candidateIndex++;
  }
  return { elements: [], candidateIndex: -1 };
}

export function query<T extends Element = Element>(
  key: SelectorKey,
  root: ParentNode = document,
): T | null {
  return resolve<T>(key, root).elements[0] ?? null;
}

export function queryAll<T extends Element = Element>(
  key: SelectorKey,
  root: ParentNode = document,
): T[] {
  return resolve<T>(key, root).elements;
}

/** aria-label fragments the selectors depend on; snapshots keep these readable */
export const STRUCTURAL_LABELS: string[] = Array.from(
  new Set(
    Object.values(SELECTORS).flatMap((def) =>
      def.candidates.flatMap((candidate) =>
        Array.from(
          candidate.matchAll(/aria-(?:label|placeholder)[*^$]?="([^"]+)"/g),
          (match) => match[1] ?? "",
        ),
      ),
    ),
  ),
).filter(Boolean);
