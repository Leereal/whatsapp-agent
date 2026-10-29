import {
  BrowserClient,
  defaultStackParser,
  getDefaultIntegrations,
  makeFetchTransport,
  Scope,
  type SeverityLevel,
} from "@sentry/browser";
import { browser } from "wxt/browser";
import { SENTRY_DSN, SENTRY_ENVIRONMENT } from "./config";
import { scrubSentryEvent } from "./shared/piiScrub";

/**
 * Error reporting for the service worker and extension pages.
 *
 * Extensions share globals with the pages they run in, so Sentry is used as a
 * standalone client and scope (no global init), without the integrations that
 * patch globals. Content scripts never talk to Sentry; they report to the
 * service worker. Events are scrubbed of personal data before sending.
 */

let scope: Scope | null = null;

export function initSentry(context: "background" | "sidepanel" | "options"): void {
  if (scope || !SENTRY_DSN) return;

  const integrations = getDefaultIntegrations({}).filter(
    (integration) =>
      !["BrowserApiErrors", "Breadcrumbs", "GlobalHandlers"].includes(integration.name),
  );

  const client = new BrowserClient({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: `whatsapp-agent@${browser.runtime.getManifest().version}`,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });

  scope = new Scope();
  scope.setClient(client);
  scope.setTag("context", context);
  client.init();
}

export function reportError(error: unknown, tags: Record<string, string> = {}): void {
  if (!scope) return;
  const forked = scope.clone();
  forked.setTags(tags);
  forked.captureException(error);
}

/**
 * Report a send that stopped because WhatsApp Web didn't behave as expected
 * (e.g. a chat wouldn't open), with the page structure around it so the
 * selectors can be fixed. Grouped by reason.
 */
export function reportSendFailure(
  reason: string,
  details: Record<string, string | number | boolean>,
  extensionVersion: string,
): void {
  if (!scope) return;
  const forked = scope.clone();
  forked.setTag("kind", "send_failure");
  forked.setTag("reason", reason);
  forked.setTag("extension_version", extensionVersion);
  forked.setFingerprint(["send_failure", reason]);
  forked.setExtras(details);
  forked.captureMessage(`WhatsApp send stopped: ${reason}`, "warning" as SeverityLevel);
}

/**
 * Report a broken WhatsApp Web page. Tagged kind=selector_failure, which the
 * "WhatsApp selector failure" alert emails about; grouped by the failing keys.
 */
export function reportSelectorFailure(keys: string[], extensionVersion: string): void {
  if (!scope) return;
  const forked = scope.clone();
  forked.setTag("kind", "selector_failure");
  forked.setTag("extension_version", extensionVersion);
  forked.setFingerprint(["selector_failure", ...[...keys].sort()]);
  forked.setExtra("failed_keys", keys);
  forked.captureMessage(
    `WhatsApp Web selectors failing: ${keys.join(", ")}`,
    "error" as SeverityLevel,
  );
}
