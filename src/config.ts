/** Build-time settings from .env.development / .env.production. Nothing secret. */

const trimSlash = (value: string) => value.replace(/\/+$/, "");

export const API_BASE_URL = trimSlash(
  import.meta.env.WXT_API_BASE_URL || "http://localhost:5000/api/v1",
);

/** Fallback until the backend's config (which names the dashboard) has loaded */
export const DEFAULT_DASHBOARD_URL = trimSlash(
  import.meta.env.WXT_DASHBOARD_URL || "http://localhost:3000",
);

export const SENTRY_DSN = import.meta.env.WXT_SENTRY_DSN || "";
export const SENTRY_ENVIRONMENT = import.meta.env.WXT_SENTRY_ENVIRONMENT || import.meta.env.MODE;

/** How often the page is checked, and how stale a report can be before the tab counts as closed */
export const HEALTH_CHECK_INTERVAL_MS = 30_000;
export const HEALTH_STALE_MS = 2 * 60_000;
/** Selector failures only count once WhatsApp Web has had time to load */
export const STARTUP_GRACE_MS = 60_000;
/** Health is re-sent at least this often even when nothing changed */
export const HEALTH_RESEND_MS = 10 * 60_000;
