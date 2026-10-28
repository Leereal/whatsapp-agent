import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { HEALTH_CHECK_INTERVAL_MS, STARTUP_GRACE_MS } from "../src/config";
import { runHealthCheck } from "../src/dom/healthCheck";
import { takeSnapshot } from "../src/dom/snapshot";
import type { ExtensionMessage, SnapshotReply } from "../src/messages";

/**
 * Runs inside WhatsApp Web. For now it only reads: it checks the page against
 * selectors.ts and reports the result to the service worker. It makes no
 * network requests of its own.
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
    ctx.setInterval(check, HEALTH_CHECK_INTERVAL_MS);

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if ((message as ExtensionMessage)?.type !== "take-snapshot") return false;

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
