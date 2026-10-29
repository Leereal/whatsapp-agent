import type { ApiErrorKind } from "./api";
import type {
  AutoReplyRequest,
  ChatMessageInput,
  ChatSyncRequest,
  DraftOutcomeRequest,
  DraftRequest,
  ManualReplyRequest,
  OutboxResultRequest,
  OutboxStatus,
  ScanChatRow,
} from "./shared/contract";
import type { ConnectionStatus, HealthState } from "./types";

/** Messages between the content script, side panel, options page and service worker */
export type ExtensionMessage =
  /** content script → service worker, after every health check */
  | { type: "health-report"; health: HealthState }
  /** side panel / options → service worker; answers with ConnectionStatus */
  | { type: "refresh-connection" }
  /** options → service worker; validates and stores the token, answers with ConnectionStatus */
  | { type: "save-token"; token: string }
  /** options → service worker */
  | { type: "clear-token" }
  /** side panel → content script; answers with { html } */
  | { type: "take-snapshot" }
  /** side panel → content script; answers with OpenChatReply */
  | { type: "read-open-chat" }
  /** side panel → content script: put a draft in the message box (and send it); answers with InsertReply */
  | { type: "insert-draft"; title: string; text: string; send: boolean }
  /** content script → service worker → Sentry; details hold page structure only */
  | {
      type: "report-send-failure";
      reason: string;
      details: Record<string, string | number | boolean>;
    }
  // API calls proxied by the service worker; each answers with an ApiReply
  | { type: "scan"; chats: ScanChatRow[] }
  | { type: "outbox-list"; statuses?: OutboxStatus[] }
  | { type: "outbox-claim"; id: string }
  | { type: "outbox-result"; id: string; result: OutboxResultRequest }
  | { type: "outbox-approve"; id: string }
  | { type: "outbox-cancel"; id: string }
  | ({ type: "manual-reply" } & ManualReplyRequest)
  | { type: "events-list" }
  | ({ type: "chat-sync" } & ChatSyncRequest)
  | ({ type: "draft-create" } & DraftRequest)
  /** content script → service worker: a client's chat read for an auto-reply */
  | ({ type: "auto-reply" } & AutoReplyRequest)
  | { type: "draft-outcome"; id: string; outcome: DraftOutcomeRequest }
  | { type: "draft-apply"; id: string; actionIndex: number }
  | { type: "handoff-close"; contactId: string };

export type ApiReply<T> = { ok: true; data: T } | { ok: false; error: string; kind: ApiErrorKind };

export type ConnectionReply = ConnectionStatus;
export type SnapshotReply = { html: string } | { error: string };
export type OpenChatReply =
  | { title: string; phone: string | null; messages: ChatMessageInput[] }
  | { error: string };
export type InsertReply = { ok: true; sent: boolean } | { ok: false; error: string };
