import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { api, ApiError } from "../src/api";
import { bytesToBase64, mimeFor, type FilePayload } from "../src/bytes";
import { HEALTH_RESEND_MS, HEALTH_STALE_MS } from "../src/config";
import { healthKey } from "../src/dom/healthCheck";
import type { ApiReply, ExtensionMessage, SavedDownload } from "../src/messages";
import {
  initSentry,
  reportError,
  reportSelectorFailure,
  reportSendFailure,
} from "../src/sentry";
import { INSTALL_TOKEN_PREFIX } from "../src/shared/contract";
import {
  connectionStatus,
  installToken,
  lastHealthReport,
  lastSelectorAlert,
  previousHealthKey,
  whatsappHealth,
} from "../src/storage";
import type { ConnectionStatus, HealthState } from "../src/types";
import { isOlderThan } from "../src/version";

/**
 * Service worker: the only part of the extension that talks to CareerCVPro.
 * Checks in every minute, keeps the connection status the side panel shows,
 * and forwards WhatsApp Web health reports from the content script.
 */

const HEARTBEAT_ALARM = "heartbeat";
/** How long to wait for WhatsApp to start saving a document after it was clicked */
const DOWNLOAD_WAIT_MS = 20_000;
const WHATSAPP_BLOB = "blob:https://web.whatsapp.com/";
const TOKEN_PATTERN = new RegExp(`^${INSTALL_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

const extensionVersion = () => browser.runtime.getManifest().version;

/** The last health report, if the WhatsApp tab sent one recently */
async function freshHealth(): Promise<HealthState | null> {
  const health = await whatsappHealth.getValue();
  if (!health) return null;
  return Date.now() - new Date(health.checkedAt).getTime() < HEALTH_STALE_MS ? health : null;
}

function statusFromError(error: unknown, previous: ConnectionStatus | null): ConnectionStatus {
  const checkedAt = new Date().toISOString();
  const base = { config: previous?.config, updateRequired: previous?.updateRequired ?? false };

  if (error instanceof ApiError) {
    switch (error.kind) {
      case "no_token":
        return { state: "no_token", message: error.message, updateRequired: false, checkedAt };
      case "rejected":
        return {
          state: "token_rejected",
          message: error.message,
          updateRequired: false,
          checkedAt,
        };
      case "offline":
        return { ...base, state: "offline", message: error.message, checkedAt };
      default:
        if (error.status >= 500) reportError(error, { area: "api" });
        return { ...base, state: "error", message: error.message, checkedAt };
    }
  }
  reportError(error, { area: "api" });
  return { ...base, state: "error", message: "Something went wrong", checkedAt };
}

async function refreshConnection(): Promise<ConnectionStatus> {
  const previous = await connectionStatus.getValue();
  let status: ConnectionStatus;

  try {
    const health = await freshHealth();
    await api.heartbeat({
      extension_version: extensionVersion(),
      whatsapp_healthy: !health || health.failures.length === 0,
    });
    const config = await api.getConfig();
    status = {
      state: "connected",
      config,
      updateRequired: isOlderThan(extensionVersion(), config.min_extension_version),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    status = statusFromError(error, previous);
  }

  await connectionStatus.setValue(status);
  return status;
}

async function handleHealthReport(health: HealthState): Promise<void> {
  await whatsappHealth.setValue(health);
  // Loading or logged out says nothing about the selectors
  if (health.pageState !== "ready") return;

  const key = healthKey(health);
  const failedKeys = health.failures.map((failure) => failure.key);

  // Automation already stops on the first failed check (it reads the stored
  // health). Reporting waits for the same failure on the next check, so a
  // page caught mid-redraw doesn't raise an alert.
  const previous = await previousHealthKey.getValue();
  await previousHealthKey.setValue(key);
  if (failedKeys.length > 0 && previous !== key) return;

  if (failedKeys.length > 0 && (await lastSelectorAlert.getValue()) !== key) {
    reportSelectorFailure(failedKeys, extensionVersion());
  }
  await lastSelectorAlert.setValue(failedKeys.length > 0 ? key : null);

  const last = await lastHealthReport.getValue();
  if (last && last.key === key && Date.now() - last.sentAt < HEALTH_RESEND_MS) return;

  try {
    await api.reportHealth({ extension_version: extensionVersion(), failures: health.failures });
    await lastHealthReport.setValue({ key, sentAt: Date.now() });
  } catch (error) {
    // No token or offline: the side panel already shows that
    if (error instanceof ApiError && error.kind !== "server") return;
    reportError(error, { area: "health" });
  }
}

async function saveToken(token: string): Promise<ConnectionStatus> {
  const trimmed = token.trim();
  if (!TOKEN_PATTERN.test(trimmed)) {
    const status: ConnectionStatus = {
      state: "token_rejected",
      message: `That doesn't look like an extension token (it starts with ${INSTALL_TOKEN_PREFIX})`,
      updateRequired: false,
      checkedAt: new Date().toISOString(),
    };
    return status;
  }
  await installToken.setValue(trimmed);
  return refreshConnection();
}

async function clearToken(): Promise<ConnectionStatus> {
  await installToken.setValue(null);
  await lastHealthReport.setValue(null);
  return refreshConnection();
}

/**
 * Saving a client's document: the WhatsApp tab clicks its download control
 * and asks to be told about the download WhatsApp starts. Its blob: URL
 * belongs to the WhatsApp page, which reads the file from it.
 */
let downloadWaiter: ((download: SavedDownload | null) => void) | null = null;
/** WhatsApp's latest downloads, in case one started before the tab asked about it */
const recentDownloads: Array<SavedDownload & { at: number }> = [];

/** The first WhatsApp download started at or after `since`, waiting for one if needed */
function expectDownload(since: number): Promise<ApiReply<SavedDownload | null>> {
  const earlier = recentDownloads.find((download) => download.at >= since);
  if (earlier) {
    const { download_id, url, filename } = earlier;
    return Promise.resolve({ ok: true, data: { download_id, url, filename } });
  }
  downloadWaiter?.(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), DOWNLOAD_WAIT_MS);
    const finish = (download: SavedDownload | null) => {
      clearTimeout(timer);
      if (downloadWaiter === finish) downloadWaiter = null;
      resolve({ ok: true, data: download });
    };
    downloadWaiter = finish;
  });
}

function onDownloadCreated(item: { id: number; url: string; finalUrl?: string; filename?: string }) {
  const url = item.finalUrl || item.url;
  if (!url.startsWith(WHATSAPP_BLOB)) return;
  const download: SavedDownload = {
    download_id: item.id,
    url,
    filename: item.filename?.split(/[\\/]/).pop() || null,
  };
  recentDownloads.unshift({ ...download, at: Date.now() });
  recentDownloads.splice(5);
  downloadWaiter?.(download);
}

/** The file was read from the page: stop the download if it's still going and drop it from the list */
async function forgetDownload(downloadId: number): Promise<ApiReply<null>> {
  await browser.downloads.cancel(downloadId).catch(() => undefined);
  await browser.downloads.erase({ id: downloadId }).catch(() => undefined);
  return { ok: true, data: null };
}

/** Run an API call for a content script or page, as an ApiReply */
async function proxy<T>(call: () => Promise<T>): Promise<ApiReply<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.kind === "server" && error.status >= 500) reportError(error, { area: "api" });
      return { ok: false, error: error.message, kind: error.kind };
    }
    reportError(error, { area: "api" });
    return { ok: false, error: "Something went wrong", kind: "server" };
  }
}

function handleMessage(message: ExtensionMessage): Promise<unknown> | null {
  switch (message?.type) {
    case "health-report":
      return handleHealthReport(message.health).then(() => ({ ok: true }));
    case "refresh-connection":
      return refreshConnection();
    case "save-token":
      return saveToken(message.token);
    case "clear-token":
      return clearToken();
    case "report-send-failure":
      reportSendFailure(message.reason, message.details, extensionVersion());
      return Promise.resolve({ ok: true, data: null });
    case "scan":
      return proxy(() => api.scan({ chats: message.chats }));
    case "outbox-list":
      return proxy(() => api.listOutbox(message.statuses));
    case "outbox-claim":
      return proxy(() => api.claim(message.id));
    case "outbox-result":
      return proxy(() => api.result(message.id, message.result));
    case "outbox-approve":
      return proxy(() => api.approve(message.id));
    case "outbox-cancel":
      return proxy(() => api.cancel(message.id));
    case "manual-reply":
      return proxy(() => api.manualReply({ title: message.title, phone: message.phone }));
    case "events-list":
      return proxy(() => api.listEvents());
    case "chat-sync":
      return proxy(() =>
        api.syncChat({ title: message.title, phone: message.phone, messages: message.messages }),
      );
    case "draft-create":
      return proxy(() =>
        api.createDraft({ title: message.title, phone: message.phone, messages: message.messages }),
      );
    case "auto-reply":
      return proxy(() =>
        api.autoReply({ title: message.title, phone: message.phone, messages: message.messages }),
      );
    case "draft-outcome":
      return proxy(() => api.draftOutcome(message.id, message.outcome));
    case "draft-apply":
      return proxy(() => api.applyDraftAction(message.id, message.actionIndex));
    case "handoff-close":
      return proxy(() => api.closeHandoff(message.contactId));
    case "pipeline-get":
      return proxy(() => api.getPipeline(message.orderId));
    case "file-upload":
      return proxy(() =>
        api.uploadFile(message.orderId, {
          kind: message.kind,
          waMessageId: message.waMessageId,
          file: message.file,
        }),
      );
    case "start-cv":
      return proxy(() => api.startCv(message.orderId, message.fileId));
    case "create-preview":
      return proxy(() => api.createPreview(message.orderId));
    case "file-content":
      return proxy(async (): Promise<FilePayload> => {
        const { bytes, mime } = await api.fileContent(message.fileId);
        return {
          base64: bytesToBase64(bytes),
          mime: mimeFor(message.filename, mime),
          filename: message.filename,
        };
      });
    case "outbox-take":
      return proxy(() => api.takeOutbox(message.id));
    case "expect-download":
      return expectDownload(message.since);
    case "forget-download":
      return forgetDownload(message.downloadId);
    default:
      return null;
  }
}

export default defineBackground(() => {
  initSentry("background");

  // Clicking the toolbar icon opens the side panel
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => reportError(error, { area: "setup" }));

  // Keep the existing schedule if the alarm survived a service worker restart
  void browser.alarms.get(HEARTBEAT_ALARM).then((alarm) => {
    if (!alarm) void browser.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) void refreshConnection();
  });
  browser.runtime.onInstalled.addListener(() => void refreshConnection());
  browser.downloads.onCreated.addListener(onDownloadCreated);
  browser.runtime.onStartup.addListener(() => void refreshConnection());

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const reply = handleMessage(message as ExtensionMessage);
    if (!reply) return false;
    reply.then(sendResponse, (error: unknown) => {
      reportError(error, { area: "message" });
      sendResponse({ state: "error", message: "Something went wrong" });
    });
    return true; // respond asynchronously
  });
});
