// GENERATED from careercvpro/backend/src/utils/piiScrub.ts — do not edit.
// Change the backend file, then run `npm run sync:contract` in the backend.

/**
 * Keeps client personal data (POPIA) out of logs and error reports.
 *
 * WhatsApp clients send phone numbers, ID numbers and email addresses, so
 * anything that may hold message text or request data goes through here
 * before it is logged or sent to Sentry.
 */

// 13-digit South African ID numbers
const SA_ID = /\b\d{13}\b/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Phone-number candidates: +27 82 123 4567, 082-123-4567, 27821234567…
// Not preceded or followed by a letter, digit or hyphen, so UUID segments
// are left alone; the digit count is checked in looksLikePhone.
const PHONE_CANDIDATE = /(?<![\w-])\+?\d[\d\s().-]{6,}\d(?![\w-])/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function looksLikePhone(match: string): boolean {
  const digits = match.replace(/\D/g, "").length;
  return digits >= 9 && digits <= 15 && !ISO_DATE.test(match);
}
// WhatsApp chat ids: 27821234567@c.us, …@s.whatsapp.net, …@lid
const CHAT_ID = /\b\d{6,}@(?:c\.us|s\.whatsapp\.net|lid|g\.us)\b/gi;

/** "+27821234567" → "+27•••••567", keeping enough to recognise a number in logs */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "•••";
  return `${value.trim().startsWith("+") ? "+" : ""}${digits.slice(0, 2)}•••••${digits.slice(-3)}`;
}

/** Replace phone numbers, ID numbers, emails and chat ids in free text */
export function scrubPii(text: string): string {
  return text
    .replace(CHAT_ID, "[chat]")
    .replace(EMAIL, "[email]")
    .replace(SA_ID, "[id-number]")
    .replace(PHONE_CANDIDATE, (match) => (looksLikePhone(match) ? "[phone]" : match));
}

/** Scrub every string inside a JSON-like value, without mutating it */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") return scrubPii(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = scrubDeep(item, depth + 1);
    }
    return output as T;
  }
  return value;
}

interface ScrubbableEvent {
  message?: string;
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    query_string?: unknown;
    url?: string;
  };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: unknown }>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  user?: unknown;
}

/**
 * Sentry beforeSend: drop request bodies, cookies and headers entirely, and
 * scrub personal data from everything else that may echo client input.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    const userAgent = event.request.headers?.["user-agent"];
    event.request.headers = userAgent ? { "user-agent": userAgent } : {};
    if (event.request.url) event.request.url = scrubPii(event.request.url);
  }
  delete event.user;

  if (event.message) event.message = scrubPii(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubPii(exception.value);
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = scrubPii(breadcrumb.message);
    if (breadcrumb.data) breadcrumb.data = scrubDeep(breadcrumb.data);
  }
  if (event.extra) event.extra = scrubDeep(event.extra);
  if (event.contexts) event.contexts = scrubDeep(event.contexts);
  return event;
}
