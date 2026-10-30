import { base64ToBytes, type FilePayload } from "./bytes";
import { API_BASE_URL } from "./config";
import { installToken } from "./storage";
import type {
  AutoReplyRequest,
  AutoReplyResponse,
  ChatSyncRequest,
  ChatSyncResponse,
  ClaimResponse,
  CurrentChat,
  CvEngine,
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
  OrderPipeline,
  OutboxItem,
  OutboxResultRequest,
  OutboxStatus,
  ScanRequest,
  ScanResponse,
  TakeOutboxResponse,
  UploadFileKind,
  UploadFileResponse,
  WhatsAppJob,
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

const GATEWAY_ERRORS = [502, 503, 504];

/** Send a request; the response is checked for auth, gateway and server errors */
async function send(path: string, init: RequestInit): Promise<Response> {
  const token = await installToken.getValue();
  if (!token) throw new ApiError("Add your extension token in the options page", "no_token");

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/whatsapp/ext${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        // A multipart upload sets its own type, with the boundary
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach CareerCVPro", "offline");
  }
  // The proxy answers for a backend that is down, e.g. while a deploy swaps containers
  if (GATEWAY_ERRORS.includes(response.status)) {
    throw new ApiError("Cannot reach CareerCVPro", "offline", response.status);
  }
  return response;
}

/** A file the API serves as bytes, with its type */
async function requestBytes(path: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const response = await send(path, {});
  if (response.ok) {
    return {
      bytes: await response.arrayBuffer(),
      mime: response.headers.get("Content-Type") ?? "application/octet-stream",
    };
  }
  return readJson(response);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return readJson<T>(await send(path, init));
}

async function readJson<T>(response: Response): Promise<T> {
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

  autoReply: (body: AutoReplyRequest) =>
    request<AutoReplyResponse>("/auto-replies", { method: "POST", body: JSON.stringify(body) }),

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

  getPipeline: (orderId: string) =>
    request<OrderPipeline>(`/orders/${encodeURIComponent(orderId)}/pipeline`),

  uploadFile: (
    orderId: string,
    input: { kind: UploadFileKind; waMessageId: string | null; file: FilePayload },
  ) => {
    const form = new FormData();
    form.append("kind", input.kind);
    if (input.waMessageId) form.append("wa_message_id", input.waMessageId);
    form.append(
      "file",
      new Blob([base64ToBytes(input.file.base64)], { type: input.file.mime }),
      input.file.filename,
    );
    return request<UploadFileResponse>(`/orders/${encodeURIComponent(orderId)}/files`, {
      method: "POST",
      body: form,
    });
  },

  startCv: (orderId: string) =>
    request<WhatsAppJob>(`/orders/${encodeURIComponent(orderId)}/start-cv`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  updateCv: (orderId: string) =>
    request<WhatsAppJob>(`/orders/${encodeURIComponent(orderId)}/update-cv`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  setCvEngine: (orderId: string, engine: CvEngine) =>
    request<OrderPipeline>(`/orders/${encodeURIComponent(orderId)}/cv-engine`, {
      method: "POST",
      body: JSON.stringify({ engine }),
    }),

  createPreview: (orderId: string) =>
    request<WhatsAppJob>(`/orders/${encodeURIComponent(orderId)}/preview`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  fileContent: (fileId: string) => requestBytes(`/files/${encodeURIComponent(fileId)}/content`),

  takeOutbox: (id: string) =>
    request<TakeOutboxResponse>(`/outbox/${encodeURIComponent(id)}/take`, { method: "POST" }),
};
