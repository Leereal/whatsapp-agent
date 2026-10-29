import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { HEALTH_CHECK_INTERVAL_MS, STARTUP_GRACE_MS } from "../src/config";
import { runHealthCheck } from "../src/dom/healthCheck";
import { takeSnapshot } from "../src/dom/snapshot";
import type { ExtensionMessage, SnapshotReply } from "../src/messages";
import { startAgent } from "../src/agent";
import { insertDraft, readOpenChat } from "../src/copilot";

/**
 * Runs inside WhatsApp Web: checks the page against selectors.ts, and runs
 * the assistant (src/agent.ts). It makes no network requests of its own;
 * everything goes through the service worker.
 */
export default defineContentScript({
  matches: ["https://web.whatsapp.com/*"],
  runAt: "document_idle",

  main(ctx) {
    const startedAt = Date.now();

    const check = () => {
      const health = runHealthCheck(document, {
        startupGraceOver: Date.now() - startedAt > STARTUP_GRACE_MS,
      });
      const message: ExtensionMessage = { type: "health-report", health };
      browser.runtime.sendMessage(message).catch(() => {
        // The service worker may be restarting; the next check retries
      });
    };

    ctx.setTimeout(check, 5_000);
    startAgent(ctx, document);
    ctx.setInterval(check, HEALTH_CHECK_INTERVAL_MS);

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const request = message as ExtensionMessage;
      if (request?.type === "read-open-chat") {
        sendResponse(readOpenChat(document));
        return false;
      }
      if (request?.type === "insert-draft") {
        insertDraft(document, request).then(sendResponse, () =>
          sendResponse({ ok: false, error: "Something went wrong in the WhatsApp tab." }),
        );
        return true; // respond asynchronously
      }
      if (request?.type !== "take-snapshot") return false;

      let reply: SnapshotReply;
      try {
        reply = { html: takeSnapshot(document) };
      } catch (error) {
        reply = { error: error instanceof Error ? error.message : "Snapshot failed" };
      }
      sendResponse(reply);
      return false;
    });
  },
});
