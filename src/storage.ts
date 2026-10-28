import { storage } from "wxt/utils/storage";
import type { ConnectionStatus, HealthState } from "./types";

/**
 * Everything the extension keeps, in chrome.storage.local so it survives the
 * service worker being stopped. The side panel watches these for live updates.
 */

/** Per-install token from the dashboard (cvp_wa_…) */
export const installToken = storage.defineItem<string | null>("local:installToken", {
  fallback: null,
});

/** Local emergency stop; works even when CareerCVPro cannot be reached */
export const localKillSwitch = storage.defineItem<boolean>("local:localKillSwitch", {
  fallback: false,
});

export const connectionStatus = storage.defineItem<ConnectionStatus | null>(
  "local:connectionStatus",
  { fallback: null },
);

export const whatsappHealth = storage.defineItem<HealthState | null>("local:whatsappHealth", {
  fallback: null,
});

/** When health was last sent to the backend, and what it said */
export const lastHealthReport = storage.defineItem<{ key: string; sentAt: number } | null>(
  "local:lastHealthReport",
  { fallback: null },
);

/** Failure set last reported to Sentry, so a broken page alerts once, not every check */
export const lastSelectorAlert = storage.defineItem<string | null>("local:lastSelectorAlert", {
  fallback: null,
});
