import { API_BASE_URL } from "./config";
import { installToken } from "./storage";
import type {
  ChatSyncRequest,
  ChatSyncResponse,
  ClaimResponse,
  CurrentChat,
  DraftOutcomeRequest,
  DraftRequest,
  DraftResponse,
  EventListResponse,
  ExtensionConfig,
  HealthReportRequest,
  HealthReportResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  ManualReplyRequest,
  OutboxItem,
  OutboxResultRequest,
  OutboxStatus,
  ScanRequest,
  ScanResponse,
} from "./shared/contract";

/**
 * CareerCVPro API client. Only the service worker uses it: content-script
 * requests would run as web.whatsapp.com and be blocked.
 */

export type ApiErrorKind = "no_token" | "rejected" | "offline" | "server";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await installToken.getValue();
  if (!token) throw new ApiError("Add your extension token in the options page", "no_token");

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/whatsapp/ext${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach CareerCVPro", "offline");
  }

  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    error?: { message?: string };
  } | null;

  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      body?.error?.message || "The extension token was rejected",
      "rejected",
      response.status,
    );
  }
  if (!response.ok || !body?.success) {
    throw new ApiError(
      body?.error?.message || `CareerCVPro returned an error (${response.status})`,
      "server",
      response.status,
    );
  }
  return body.data as T;
}

export const api = {
  getConfig: () => request<ExtensionConfig>("/config"),

  heartbeat: (body: HeartbeatRequest) =>
    request<HeartbeatResponse>("/heartbeat", { method: "POST", body: JSON.stringify(body) }),

  reportHealth: (body: HealthReportRequest) =>
    request<HealthReportResponse>("/health", { method: "POST", body: JSON.stringify(body) }),

  scan: (body: ScanRequest) =>
    request<ScanResponse>("/chats/scan", { method: "POST", body: JSON.stringify(body) }),

  manualReply: (body: ManualReplyRequest) =>
    request<unknown>("/chats/manual-reply", { method: "POST", body: JSON.stringify(body) }),

  listOutbox: (statuses?: OutboxStatus[]) =>
    request<OutboxItem[]>(statuses?.length ? `/outbox?status=${statuses.join(",")}` : "/outbox"),

  claim: (id: string) =>
    request<ClaimResponse>(`/outbox/${encodeURIComponent(id)}/claim`, { method: "POST" }),

  result: (id: string, body: OutboxResultRequest) =>
    request<OutboxItem>(`/outbox/${encodeURIComponent(id)}/result`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  approve: (id: string) =>
    request<OutboxItem>(`/outbox/${encodeURIComponent(id)}/approve`, { method: "POST" }),

  cancel: (id: string) =>
    request<OutboxItem>(`/outbox/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listEvents: () => request<EventListResponse>("/events?limit=30"),

  syncChat: (body: ChatSyncRequest) =>
    request<ChatSyncResponse>("/chats/sync", { method: "POST", body: JSON.stringify(body) }),

  createDraft: (body: DraftRequest) =>
    request<DraftResponse>("/drafts", { method: "POST", body: JSON.stringify(body) }),

  draftOutcome: (id: string, body: DraftOutcomeRequest) =>
    request<null>(`/drafts/${encodeURIComponent(id)}/outcome`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  applyDraftAction: (id: string, actionIndex: number) =>
    request<CurrentChat>(`/drafts/${encodeURIComponent(id)}/apply`, {
      method: "POST",
      body: JSON.stringify({ action_index: actionIndex }),
    }),

  closeHandoff: (contactId: string) =>
    request<CurrentChat>(`/contacts/${encodeURIComponent(contactId)}/close-handoff`, {
      method: "POST",
    }),
};
