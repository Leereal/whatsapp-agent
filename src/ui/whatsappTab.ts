import { browser } from "wxt/browser";
import type { ExtensionMessage } from "../messages";

export const WHATSAPP_URL = "https://web.whatsapp.com/";

export type TabReply<T> =
  | { status: "ok"; reply: T }
  /** WhatsApp Web isn't open */
  | { status: "no_tab" }
  /** The tab was opened before the extension loaded (or is reloading) */
  | { status: "no_answer" };

/** Ask the content script in the WhatsApp Web tab */
export async function askWhatsAppTab<T>(message: ExtensionMessage): Promise<TabReply<T>> {
  const [tab] = await browser.tabs.query({ url: `${WHATSAPP_URL}*` });
  if (!tab?.id) return { status: "no_tab" };
  try {
    const reply = (await browser.tabs.sendMessage(tab.id, message)) as T | undefined;
    return reply === undefined ? { status: "no_answer" } : { status: "ok", reply };
  } catch {
    return { status: "no_answer" };
  }
}

export const TAB_PROBLEMS = {
  no_tab: "Open WhatsApp Web first.",
  no_answer: "The WhatsApp tab did not answer. Reload it and try again.",
} as const;
