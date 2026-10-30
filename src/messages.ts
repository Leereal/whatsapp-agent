import type { ApiErrorKind } from "./api";
import type { FilePayload } from "./bytes";
import type { MediaMessage } from "./dom/media";
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
  UploadFileKind,
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
  /** side panel → content script: the client's photos and documents in the open chat; answers with MediaListReply */
  | { type: "list-media" }
  /** side panel → content script: read one of them; answers with CaptureResult */
  | { type: "capture-media"; title: string; waMessageId: string; kind: "image" | "document" }
  /** side panel → content script: put a preview in the chat for me to send; answers with PasteResult */
  | { type: "paste-file"; title: string; outboxId: string; file: FilePayload; caption: string }
  /** content script → service worker: WhatsApp's download started since `since`; answers with ApiReply<SavedDownload | null> */
  | { type: "expect-download"; since: number }
  /** content script → service worker: don't keep that download (it was read from the page) */
  | { type: "forget-download"; downloadId: number }
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
  | { type: "handoff-close"; contactId: string }
  | { type: "pipeline-get"; orderId: string }
  | {
      type: "file-upload";
      orderId: string;
      kind: UploadFileKind;
      waMessageId: string | null;
      file: FilePayload;
    }
  | { type: "start-cv"; orderId: string; fileId?: string }
  | { type: "create-preview"; orderId: string }
  /** answers with ApiReply<FilePayload> */
  | { type: "file-content"; fileId: string; filename: string }
  | { type: "outbox-take"; id: string };

export type ApiReply<T> = { ok: true; data: T } | { ok: false; error: string; kind: ApiErrorKind };

export type ConnectionReply = ConnectionStatus;
export type SnapshotReply = { html: string } | { error: string };
export type OpenChatReply =
  | { title: string; phone: string | null; messages: ChatMessageInput[] }
  | { error: string };
export type InsertReply = { ok: true; sent: boolean } | { ok: false; error: string };
export type MediaListReply = { title: string; items: MediaMessage[] } | { error: string };
/** A download WhatsApp started, as the service worker saw it */
export interface SavedDownload {
  download_id: number;
  url: string;
  filename: string | null;
}
