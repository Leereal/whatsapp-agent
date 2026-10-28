import { resolve, SELECTORS, type SelectorDef, type SelectorKey } from "../selectors";
import type { SelectorFailure } from "../shared/contract";
import type { HealthState } from "../types";

/**
 * Checks that WhatsApp Web still looks the way selectors.ts expects.
 * Read-only: it never clicks or types. Any failure turns automation off.
 */

/** Reported when the page is not in English, because aria-labels would not match */
export const LANGUAGE_FAILURE_KEY = "language";

export interface HealthCheckOptions {
  /** WhatsApp Web has had time to load, so a missing chat list is a real failure */
  startupGraceOver: boolean;
}

function failureFor(key: SelectorKey): SelectorFailure {
  return { key, candidates_tried: SELECTORS[key].candidates.length };
}

export function isEnglishPage(doc: Document): boolean {
  const language = doc.documentElement.lang?.trim().toLowerCase();
  // WhatsApp Web normally sets lang; if it doesn't, rely on the selectors
  return !language || language.startsWith("en");
}

export function runHealthCheck(doc: Document, options: HealthCheckOptions): HealthState {
  const checkedAt = new Date().toISOString();

  if (resolve("loginQrCode", doc).elements.length > 0) {
    return { pageState: "logged_out", chatOpen: false, failures: [], checkedAt };
  }

  const chatListFound = resolve("chatList", doc).elements.length > 0;
  if (!chatListFound && !options.startupGraceOver) {
    return { pageState: "loading", chatOpen: false, failures: [], checkedAt };
  }

  const chatOpen = resolve("conversationPanel", doc).elements.length > 0;
  const failures: SelectorFailure[] = [];

  if (!isEnglishPage(doc)) {
    failures.push({ key: LANGUAGE_FAILURE_KEY, candidates_tried: 0 });
  }

  for (const key of Object.keys(SELECTORS) as SelectorKey[]) {
    const def: SelectorDef = SELECTORS[key];
    if (def.optional || def.scope === "action") continue;
    if (def.scope === "chat" && !chatOpen) continue;
    if (key === "conversationPanel") continue; // decides chatOpen; absence is normal

    if (resolve(key, doc).elements.length === 0) failures.push(failureFor(key));
  }

  return { pageState: "ready", chatOpen, failures, checkedAt };
}

/** Stable identity of a result, to report only when something changed */
export function healthKey(health: HealthState): string {
  return [health.pageState, ...health.failures.map((failure) => failure.key).sort()].join("|");
}
