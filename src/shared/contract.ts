// GENERATED from careercvpro/backend/src/types/whatsappContract.ts — do not edit.
// Change the backend file, then run `npm run sync:contract` in the backend.

/**
 * WhatsApp assistant API contract, shared by the backend, the dashboard and
 * the Chrome extension.
 *
 * This file is the source of truth. It holds constants and types only (no
 * imports), so it can be copied unchanged: edit it here, then run
 * `npm run sync:contract` to update the copies in ../frontend and
 * ../whatsapp-agent.
 *
 * Field names are snake_case, like the rest of the CareerCVPro API.
 */

export const ORDER_STAGES = [
  "new_lead",
  "awaiting_cv",
  "cv_received",
  "in_progress",
  "preview_sent",
  "pending_payment",
  "paid",
  "delivered",
  "follow_up",
  "cancelled",
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export const PRODUCTS = ["cv_cover_letter", "cv_cover_letter_linkedin"] as const;
export type Product = (typeof PRODUCTS)[number];

export const OUTBOX_KINDS = [
  "pricing",
  "reply",
  "request_cv",
  "payment_details",
  "preview",
  "final_pdf",
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export const OUTBOX_STATUSES = [
  "needs_approval",
  "scheduled",
  "claimed",
  "sent",
  "failed",
  "cancelled",
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Message types that may be switched to auto-send */
export const AUTO_SEND_TYPES = ["pricing", "request_cv"] as const;
export type AutoSendType = (typeof AUTO_SEND_TYPES)[number];

export const AI_TIERS = ["basic", "advanced"] as const;
export type WhatsAppAITier = (typeof AI_TIERS)[number];

export const AI_EFFORTS = ["low", "medium", "high"] as const;
export type WhatsAppAIEffort = (typeof AI_EFFORTS)[number];

export const INSTALL_ENVIRONMENTS = ["production", "development"] as const;
export type InstallEnvironment = (typeof INSTALL_ENVIRONMENTS)[number];

export const EVENT_SEVERITIES = ["info", "warn", "error"] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

/** Event types written to wa_events. Later phases add more. */
export const EVENT_TYPES = [
  "install_created",
  "install_rotated",
  "install_revoked",
  "settings_updated",
  "kill_switch_on",
  "kill_switch_off",
  "selector_failure",
  "selector_recovered",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Header prefix that marks an extension install token */
export const INSTALL_TOKEN_PREFIX = "cvp_wa_";

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------

/** The whatsapp_* rows in system_settings, typed (keys without the prefix) */
export interface WhatsAppSettings {
  enabled: boolean;
  kill_switch: boolean;
  auto_send_types: AutoSendType[];
  delay_min_seconds: number;
  delay_max_seconds: number;
  rate_limit_per_hour: number;
  chat_cooldown_minutes: number;
  manual_pause_hours: number;
  missed_chat_minutes: number;
  pricing_template: string;
  request_cv_template: string;
  payment_details_template: string;
  preview_caption: string;
  final_pdf_caption: string;
  style_notes: string;
  ai_tier: WhatsAppAITier;
  ai_effort: WhatsAppAIEffort;
  cv_tier: WhatsAppAITier;
  cv_autostart: boolean;
  watermark_text: string;
  test_numbers: string[];
  retention_months: number;
  min_extension_version: string;
}

export type WhatsAppSettingsUpdate = Partial<WhatsAppSettings>;

// ------------------------------------------------------------------
// Extension endpoints (/api/v1/whatsapp/ext, install token)
// ------------------------------------------------------------------

export interface InstallInfo {
  id: string;
  label: string;
  environment: InstallEnvironment;
}

/** GET /ext/config */
export interface ExtensionConfig {
  install: InstallInfo;
  enabled: boolean;
  kill_switch: boolean;
  auto_send_types: AutoSendType[];
  delay_min_seconds: number;
  delay_max_seconds: number;
  missed_chat_minutes: number;
  min_extension_version: string;
  dashboard_url: string;
}

/** POST /ext/heartbeat */
export interface HeartbeatRequest {
  extension_version: string;
  whatsapp_healthy: boolean;
}

export interface HeartbeatResponse {
  enabled: boolean;
  kill_switch: boolean;
  min_extension_version: string;
  server_time: string;
}

export interface SelectorFailure {
  key: string;
  candidates_tried: number;
}

/** POST /ext/health */
export interface HealthReportRequest {
  extension_version: string;
  failures: SelectorFailure[];
}

export interface HealthReportResponse {
  automation_allowed: boolean;
}

// ------------------------------------------------------------------
// Shared records
// ------------------------------------------------------------------

export interface WhatsAppEvent {
  id: string;
  type: string;
  severity: EventSeverity;
  contact_id: string | null;
  order_id: string | null;
  install_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface EventListResponse {
  events: WhatsAppEvent[];
  pagination: { page: number; limit: number; total: number };
}

// ------------------------------------------------------------------
// Dashboard endpoints (/api/v1/whatsapp/admin, system admin)
// ------------------------------------------------------------------

export interface InstallToken {
  id: string;
  label: string;
  token_prefix: string;
  environment: InstallEnvironment;
  extension_version: string | null;
  whatsapp_healthy: boolean | null;
  health_failures: string[];
  last_health_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** POST /admin/installs and /admin/installs/:id/rotate. The token is shown once. */
export interface IssuedInstallToken {
  install: InstallToken;
  token: string;
}

export interface CreateInstallRequest {
  label: string;
  environment?: InstallEnvironment;
}

/** GET /admin/summary */
export interface WhatsAppSummary {
  enabled: boolean;
  kill_switch: boolean;
  stages: Record<OrderStage, number>;
  new_leads_today: number;
  pop_awaiting_verification: number;
  failures_24h: number;
  installs: {
    active: number;
    online: number;
    unhealthy: number;
  };
}
