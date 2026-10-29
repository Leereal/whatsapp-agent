import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { callBackground, warnUnlessOffline } from "./bridge";
import { OpenChatWatcher } from "./copilot";
import { UserActivity } from "./dom/userActivity";
import { PageLock } from "./pageLock";
import { normalizePhone } from "./phone";
import { ChatReader, readForReply, type ReadOutcome } from "./reader";
import { ChatScanner } from "./scanner";
import { SendScheduler } from "./scheduler";
import { sendItem, type SendOutcome } from "./sender";
import { query } from "./selectors";
import type { OutboxItem } from "./shared/contract";
import { connectionStatus, whatsappHealth } from "./storage";

/**
 * The assistant inside WhatsApp Web: watches the chat list, reports new leads
 * and labelled chats, reads chats of clients who wrote again (auto-replies),
 * runs scheduled sends one at a time, and backs off from any chat I reply to
 * myself.
 */

const SCAN_DEBOUNCE_MS = 1_500;
const SCAN_INTERVAL_MS = 30_000;
const TICK_MS = 5_000;
const OUTBOX_SYNC_MS = 60_000;
const OPEN_CHAT_CHECK_MS = 3_000;

/** Connected, switched on, and the page checks pass */
async function readyConfig() {
  const [status, health] = await Promise.all([
    connectionStatus.getValue(),
    whatsappHealth.getValue(),
  ]);
  const config = status?.state === "connected" ? status.config : undefined;
  if (!config?.enabled) return null;
  if (health?.pageState !== "ready" || health.failures.length > 0) return null;
  return config;
}

export function startAgent(ctx: ContentScriptContext, doc: Document): void {
  const warn = warnUnlessOffline;

  const activity = new UserActivity(doc, (title) => {
    scheduler.removeChat(title);
    reader.removeChat(title);
    callBackground({ type: "manual-reply", title, phone: normalizePhone(title) }).catch(warn);
  });
  // Sending and reading both open chats, so only one runs at a time
  const page = new PageLock();
  const scheduler = new SendScheduler(
    async (item) =>
      (await page.run(() => sendItem(item, activity, doc))) ??
      ({ kind: "retry", afterMs: 5_000, reason: "page_busy" } satisfies SendOutcome),
    warn,
  );
  const reader = new ChatReader(
    async (title) =>
      (await page.run(() => readForReply(title, activity, doc))) ??
      ({ kind: "retry", afterMs: 5_000, reason: "page_busy" } satisfies ReadOutcome),
    warn,
  );
  const scanner = new ChatScanner(doc, (decisions) => {
    for (const decision of decisions) {
      if (decision.action === "scheduled" && decision.outbox) scheduler.upsert(decision.outbox);
      if (decision.action === "read") reader.add(decision.title);
    }
  });

  // Sends come first; a chat is read only when no send is due
  const tick = async () => {
    if (await scheduler.tick()) return;
    const read = await reader.tick();
    if (read?.kind === "done" && read.outbox) scheduler.upsert(read.outbox);
  };

  let scanning = false;
  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      const config = await readyConfig();
      if (config) await scanner.scan(config.label_names);
    } catch (error) {
      warn(error);
    } finally {
      scanning = false;
    }
  };

  const syncOutbox = async () => {
    try {
      if (!(await readyConfig())) return;
      const items = await callBackground<OutboxItem[]>({
        type: "outbox-list",
        statuses: ["scheduled", "claimed"],
      });
      scheduler.sync(items);
    } catch (error) {
      warn(error);
    }
  };

  // Re-scan shortly after the chat list changes (new message, label, unread count)
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void scan(), SCAN_DEBOUNCE_MS);
  });
  let observed: Element | null = null;
  const observeChatList = () => {
    const list = query("chatList", doc);
    if (list && list !== observed) {
      observer.disconnect();
      observer.observe(list, { childList: true, subtree: true, characterData: true });
      observed = list;
    }
  };

  ctx.setInterval(() => {
    observeChatList();
    void scan();
  }, SCAN_INTERVAL_MS);
  // Reading and reporting the open chat isn't automation: it only needs a
  // connection and a page whose selectors check out
  const openChat = new OpenChatWatcher(doc, async () => {
    const [status, health] = await Promise.all([
      connectionStatus.getValue(),
      whatsappHealth.getValue(),
    ]);
    return (
      status?.state === "connected" &&
      health?.pageState === "ready" &&
      health.failures.length === 0
    );
  });
  ctx.setInterval(() => void openChat.check(), OPEN_CHAT_CHECK_MS);

  ctx.setInterval(() => void tick(), TICK_MS);
  ctx.setInterval(() => void syncOutbox(), OUTBOX_SYNC_MS);
  ctx.setTimeout(() => {
    observeChatList();
    void scan();
    void syncOutbox();
  }, 10_000);

  ctx.onInvalidated(() => {
    observer.disconnect();
    clearTimeout(debounce);
    activity.dispose();
  });
}
