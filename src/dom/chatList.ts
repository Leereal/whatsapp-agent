import { normalizePhone } from "../phone";
import { queryAll, queryInside } from "../selectors";
import type { ScanChatRow } from "../shared/contract";

/**
 * Reads the visible chat-list rows. WhatsApp only renders the rows on screen,
 * so scrolling the list reveals more; each row is read independently.
 */

export interface ChatRow extends ScanChatRow {
  element: Element;
}

const CLOCK = /^(\d{1,2}):(\d{2})(?:\s?([ap])\.?m\.?)?$/i;
const DAY_OR_DATE =
  /^(yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;

const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

/** Elements with text but no child elements: titles, times, label chips, counts */
function leaves(row: Element): Element[] {
  return Array.from(row.querySelectorAll("*")).filter(
    (element) => element.childElementCount === 0 && normalise(element.textContent ?? "") !== "",
  );
}

/**
 * The row's time as an ISO date when it shows a clock time (today), else
 * null. A clock time later than now belongs to yesterday.
 */
export function parseRowTime(text: string, now = new Date()): string | null {
  const match = CLOCK.exec(text.trim());
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "p" && hours < 12) hours += 12;
  if (meridiem === "a" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;

  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() > now.getTime() + 60_000) at.setDate(at.getDate() - 1);
  return at.toISOString();
}

function unreadCount(row: Element): number {
  const badge = queryInside("unreadBadge", row);
  if (!badge) return 0;
  const digits = /\d+/.exec(badge.getAttribute("aria-label") ?? badge.textContent ?? "");
  // A badge without a number is a chat I marked unread myself: not a new message
  return digits ? Number(digits[0]) : 0;
}

export function readChatRows(root: ParentNode, labelNames: string[], now = new Date()): ChatRow[] {
  const labels = new Map(labelNames.map((name) => [name.trim().toLowerCase(), name]));
  const rows: ChatRow[] = [];

  for (const element of queryAll("chatRow", root)) {
    const titleElement = queryInside("chatRowTitle", element);
    const title = normalise(titleElement?.getAttribute("title") || titleElement?.textContent || "");
    if (!title) continue;

    let lastActivity: string | null = null;
    let sawTime = false;
    const rowLabels: string[] = [];
    for (const leaf of leaves(element)) {
      if (titleElement && (leaf === titleElement || titleElement.contains(leaf))) continue;
      const text = normalise(leaf.textContent ?? "");
      const label = labels.get(text.toLowerCase());
      if (label) {
        if (!rowLabels.includes(label)) rowLabels.push(label);
      } else if (!sawTime && (CLOCK.test(text) || DAY_OR_DATE.test(text))) {
        sawTime = true;
        lastActivity = parseRowTime(text, now);
      }
    }

    rows.push({
      element,
      title,
      phone: normalizePhone(title),
      unread_count: unreadCount(element),
      last_activity: lastActivity,
      labels: rowLabels,
    });
  }
  return rows;
}

/**
 * Rows worth telling the backend about: labelled chats (existing clients) and
 * unsaved numbers with unread messages (possible new leads). Everything else
 * stays in the browser.
 */
export function isReportable(row: ScanChatRow): boolean {
  return row.labels.length > 0 || (row.phone !== null && row.unread_count > 0);
}
