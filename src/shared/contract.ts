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
  "pricing_queued",
  "pricing_scheduled",
  "pricing_sent",
  "pricing_skipped",
  "send_failed",
  "outbox_sent",
  "outbox_approved",
  "outbox_cancelled",
  "manual_reply_pause",
  "order_stage_changed",
  "order_product_set",
  "pop_received",
  "handoff_opened",
  "handoff_closed",
  "draft_failed",
  "reply_scheduled",
  "reply_queued",
  "reply_sent",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const CONTACT_SOURCES = ["fb_ad", "ig_ad", "organic", "unknown"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const MEDIA_TYPES = ["none", "image", "document", "audio", "video", "sticker"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** What the client's latest message is about, as the AI reads it */
export const DRAFT_INTENTS = [
  "greeting",
  "pricing_question",
  "ready_to_order",
  "sent_cv",
  "target_role_info",
  "proof_of_payment",
  "process_question",
  "revision_request",
  "complaint",
  "refund_request",
  "payment_dispute",
  "unrelated",
  "other",
] as const;
export type DraftIntent = (typeof DRAFT_INTENTS)[number];

/**
 * Intents whose replies may ever go out without me, once switched on in
 * settings. Payments, complaints, refunds, disputes, revisions and anything
 * unrelated always wait for me.
 */
export const AUTO_REPLY_INTENTS = [
  "greeting",
  "pricing_question",
  "ready_to_order",
  "sent_cv",
  "target_role_info",
  "process_question",
] as const;
export type AutoReplyIntent = (typeof AUTO_REPLY_INTENTS)[number];

/**
 * What a draft may suggest besides its text. The backend checks every one;
 * nothing happens until I click it (handoff_to_human applies at once).
 */
export const DRAFT_ACTION_TYPES = [
  "send_pricing",
  "request_old_cv",
  "send_payment_details",
  "set_product",
  "update_order_stage",
  "flag_pop_received",
  "handoff_to_human",
] as const;
export type DraftActionType = (typeof DRAFT_ACTION_TYPES)[number];

/** Template actions add a saved message to the reply instead of changing data */
export const TEMPLATE_ACTIONS = {
  send_pricing: "pricing",
  request_old_cv: "request_cv",
  send_payment_details: "payment_details",
} as const;
export type TemplateKind = (typeof TEMPLATE_ACTIONS)[keyof typeof TEMPLATE_ACTIONS];

export const DRAFT_OUTCOMES = ["inserted", "sent", "edited", "discarded"] as const;
export type DraftOutcome = (typeof DRAFT_OUTCOMES)[number];

export const REPLY_EXAMPLE_SOURCES = ["import", "approved_draft", "manual"] as const;
export type ReplyExampleSource = (typeof REPLY_EXAMPLE_SOURCES)[number];

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
  /** WhatsApp label name → order stage, e.g. { "Pending payment": "pending_payment" } */
  label_stages: Record<string, OrderStage>;
  /** Price in rand of each product */
  product_prices: Record<Product, number>;
  /** Intents the assistant may answer by itself; the rest wait in the queue */
  auto_reply_intents: AutoReplyIntent[];
  /** How sure the AI must be (0–1) before a reply goes out by itself */
  auto_reply_min_confidence: number;
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
  /** Names of the WhatsApp labels to look for in the chat list */
  label_names: string[];
  /** A pricing message is saved, so pricing can be sent at all */
  pricing_ready: boolean;
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

/**
 * One chat-list row the extension reports. Rows are only sent when they are
 * labelled (to import the order) or look like a new lead (to offer pricing).
 */
export interface ScanChatRow {
  /** Row title as WhatsApp shows it: a phone number for unsaved contacts, else a name */
  title: string;
  /** E.164 when the title is a phone number */
  phone: string | null;
  unread_count: number;
  /** Time of the last message when the row shows one for today, else null */
  last_activity: string | null;
  labels: string[];
}

/** POST /ext/chats/scan */
export interface ScanRequest {
  chats: ScanChatRow[];
}

/**
 * scheduled / queued: pricing was scheduled or waits for approval.
 * read: a client wrote again; open the chat and send its messages to
 * /ext/auto-replies so the assistant can answer.
 */
export type ScanAction = "none" | "scheduled" | "queued" | "read";

export interface ScanDecision {
  title: string;
  action: ScanAction;
  /** Why nothing was scheduled (e.g. "labelled", "existing_chat", "no_template") */
  reason?: string;
  outbox?: OutboxItem;
}

export interface ScanResponse {
  decisions: ScanDecision[];
}

/** A message waiting to be sent, as the extension and side panel see it */
export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  status: OutboxStatus;
  /** Sent without me approving it (an auto-send type) */
  auto: boolean;
  not_before: string | null;
  failure_reason: string | null;
  created_at: string;
  contact: {
    id: string;
    title: string;
    phone: string | null;
    is_test: boolean;
  };
  /** For a reply the assistant wrote: the text that will be sent */
  text: string | null;
  /** For a reply the assistant wrote: what it read and how sure it was */
  draft: { intent: DraftIntent; confidence: number | null } | null;
}

/** POST /ext/outbox/:id/claim, called right before sending */
export interface ClaimResponse {
  go: boolean;
  reason?: string;
  /** When the refusal is temporary: try again after this */
  retry_after_seconds?: number;
  body?: string;
  /** For a reply: the client's message it answers. Send only while that is still the chat's latest message. */
  answers_message_id?: string;
}

/** POST /ext/outbox/:id/result */
export interface OutboxResultRequest {
  status: "sent" | "failed" | "skipped";
  /** Why it failed or was skipped (e.g. "existing_chat", "composer_not_empty") */
  reason?: string;
  /** data-id of the sent message */
  wa_message_id?: string;
  /** "fb_ad" / "ig_ad" when the chat started from an ad */
  source?: ContactSource;
}

/** POST /ext/chats/manual-reply: I sent a message myself in this chat */
export interface ManualReplyRequest {
  title: string;
  phone: string | null;
}

/** One message read from the open chat */
export interface ChatMessageInput {
  /** data-id of the message */
  wa_message_id: string;
  direction: "in" | "out";
  /** The message text; "" for media without a caption */
  text: string;
  media_type: MediaType;
  /** When WhatsApp says it was sent (to the minute), if shown */
  sent_at: string | null;
}

/** The open chat as the side panel shows it */
export interface CurrentChat {
  contact: {
    id: string;
    title: string;
    phone: string | null;
    source: ContactSource;
    handoff_open: boolean;
    auto_paused_until: string | null;
    is_test: boolean;
  };
  order: {
    id: string;
    stage: OrderStage;
    product: Product | null;
    price_cents: number | null;
    pop_received_at: string | null;
  } | null;
}

/** POST /ext/chats/sync: the latest messages of the chat I have open */
export interface ChatSyncRequest {
  title: string;
  phone: string | null;
  /** Oldest first */
  messages: ChatMessageInput[];
}

export interface ChatSyncResponse {
  /** Only chats the assistant already knows are stored; others are ignored */
  known: boolean;
  new_messages: number;
  chat: CurrentChat | null;
}

/** POST /ext/drafts: draft a reply for the open chat (adds the chat if it's new) */
export type DraftRequest = ChatSyncRequest;

/** POST /ext/auto-replies: a client's chat the extension read after a scan said "read" */
export type AutoReplyRequest = ChatSyncRequest;

export interface AutoReplyResponse {
  /** scheduled: it goes out by itself; queued: it waits for my approval */
  action: "scheduled" | "queued" | "none";
  /** Why it isn't going out by itself, e.g. "intent_off", "low_confidence", "handed_off" */
  reason?: string;
  outbox?: OutboxItem;
}

export interface DraftAction {
  type: DraftActionType;
  stage?: OrderStage;
  product?: Product;
  /** Why the AI suggests it, in a few words */
  reason: string;
}

export interface DraftResponse {
  id: string;
  text: string;
  intent: DraftIntent;
  actions: DraftAction[];
  suggested_stage: OrderStage | null;
  handoff: { required: boolean; reason: string | null };
  confidence: number;
  /** The tier that wrote it; differs from tier_requested when Advanced fell back */
  tier: WhatsAppAITier;
  tier_requested: WhatsAppAITier;
  /** What the safety filter removed from the reply, e.g. "price" */
  policy_flags: string[];
  /** Saved messages for the template actions; missing when not set up */
  templates: Partial<Record<TemplateKind, string>>;
  chat: CurrentChat;
}

/** POST /ext/drafts/:id/outcome */
export interface DraftOutcomeRequest {
  outcome: DraftOutcome;
  /** The text that was inserted or sent, when it differs from the draft */
  final_text?: string;
}

/** POST /ext/drafts/:id/apply: carry out one of the draft's data actions */
export interface ApplyDraftActionRequest {
  action_index: number;
}

// ------------------------------------------------------------------
// Orders (dashboard board)
// ------------------------------------------------------------------

export interface WhatsAppOrder {
  id: string;
  stage: OrderStage;
  product: Product | null;
  price_cents: number | null;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  is_test: boolean;
  contact: {
    id: string;
    display_name: string | null;
    phone: string | null;
    source: ContactSource;
    last_inbound_at: string | null;
    auto_paused_until: string | null;
    /** The AI handed this chat to me */
    handoff_open: boolean;
  };
}

export interface UpdateOrderRequest {
  stage?: OrderStage;
}

export interface WhatsAppMessage {
  id: string;
  wa_message_id: string | null;
  direction: "in" | "out";
  sent_by: "client" | "me" | "ai_draft" | "ai_auto" | "system";
  body: string | null;
  media_type: MediaType;
  wa_timestamp: string | null;
  created_at: string;
}

export interface WhatsAppDraft {
  id: string;
  intent: DraftIntent;
  draft_text: string;
  final_text: string | null;
  outcome: DraftOutcome | null;
  actions: DraftAction[];
  handoff_reason: string | null;
  confidence: number | null;
  tier_requested: WhatsAppAITier;
  tier_used: WhatsAppAITier;
  policy_flags: string[];
  latency_ms: number | null;
  created_at: string;
}

/** GET /admin/orders/:id */
export interface WhatsAppOrderDetail {
  order: WhatsAppOrder & {
    target_role: string | null;
    notes: string | null;
    pop_received_at: string | null;
  };
  contact: {
    id: string;
    display_name: string | null;
    phone: string | null;
    source: ContactSource;
    first_inbound_at: string | null;
    last_inbound_at: string | null;
    last_outbound_at: string | null;
    auto_paused_until: string | null;
    handoff_open: boolean;
    opted_out: boolean;
    is_test: boolean;
  };
  /** Oldest first, the latest 100 */
  messages: WhatsAppMessage[];
  /** Newest first */
  drafts: WhatsAppDraft[];
  events: WhatsAppEvent[];
}

// ------------------------------------------------------------------
// Reply examples (my past replies, used as style examples)
// ------------------------------------------------------------------

export interface ReplyExample {
  id: string;
  client_text: string;
  my_reply: string;
  context: string | null;
  stage: OrderStage | null;
  tags: string[];
  source: ReplyExampleSource;
  is_active: boolean;
  /** Has an embedding, so it can be found by similarity */
  embedded: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReplyExampleInput {
  client_text: string;
  my_reply: string;
  context?: string | null;
  stage?: OrderStage | null;
  tags?: string[];
  is_active?: boolean;
}

export interface ReplyExampleListResponse {
  examples: ReplyExample[];
  pagination: { page: number; limit: number; total: number };
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
  /** Chats the AI handed to me that are still open */
  handoffs_open: number;
  drafts_today: {
    count: number;
    input_tokens: number;
    output_tokens: number;
  };
  installs: {
    active: number;
    online: number;
    unhealthy: number;
  };
}
