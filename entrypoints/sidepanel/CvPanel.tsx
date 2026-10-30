import { useCallback, useState } from "react";
import { bytesToBase64, mimeFor, type FilePayload } from "../../src/bytes";
import { callBackground } from "../../src/bridge";
import { sameTitle } from "../../src/dom/chat";
import type { CaptureResult, MediaMessage, PasteResult } from "../../src/dom/media";
import type { MediaListReply } from "../../src/messages";
import {
  CV_FILE_TYPES,
  MAX_FILE_BYTES,
  type OrderPipeline,
  type TakeOutboxResponse,
  type UploadFileResponse,
  type WhatsAppJob,
} from "../../src/shared/contract";
import { openChatState } from "../../src/storage";
import { JOBS, reasonText } from "../../src/ui/labels";
import { usePolling } from "../../src/ui/usePolling";
import { useStorageItem } from "../../src/ui/useStorageItem";
import { askWhatsAppTab, TAB_PROBLEMS } from "../../src/ui/whatsappTab";

const isActive = (job: WhatsAppJob) => job.status === "queued" || job.status === "running";

const KIND_LABELS = { image: "Photo", document: "Document" } as const;

/** One preview image per file, kept while the side panel is open */
const previewCache = new Map<string, string>();

async function previewImage(fileId: string): Promise<{ url: string; file: FilePayload }> {
  const file = await callBackground<FilePayload>({
    type: "file-content",
    fileId,
    filename: "CV preview.jpg",
  });
  const url = previewCache.get(fileId) ?? `data:${file.mime};base64,${file.base64}`;
  previewCache.set(fileId, url);
  return { url, file };
}

/**
 * The open client chat's CV work: save the CV they sent, have it written in
 * CV Studio, make the watermarked preview and put it in the chat for me to
 * send.
 */
export function CvPanel({ enabled, dashboardUrl }: { enabled: boolean; dashboardUrl: string }) {
  const { value: open } = useStorageItem(openChatState);
  const [pipeline, setPipeline] = useState<OrderPipeline | null>(null);
  const [media, setMedia] = useState<MediaMessage[]>([]);
  const [thumbnail, setThumbnail] = useState<{ fileId: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shownOrder, setShownOrder] = useState<string | null>(null);

  const title = open?.title ?? null;
  const orderId = open?.known ? (open.chat?.order?.id ?? null) : null;

  // Everything shown belongs to one order: switching chats starts afresh
  if (orderId !== shownOrder) {
    setShownOrder(orderId);
    setPipeline(null);
    setMedia([]);
    setError(null);
    setNotice(null);
  }

  const thumbnailId = thumbnail?.fileId ?? null;
  const loadPipeline = useCallback(async () => {
    if (!orderId) return;
    try {
      const next = await callBackground<OrderPipeline>({ type: "pipeline-get", orderId });
      setPipeline(next);
      const previewFile = next.preview?.file_id;
      if (previewFile && thumbnailId !== previewFile) {
        const { url } = await previewImage(previewFile);
        setThumbnail({ fileId: previewFile, url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the order's CV work");
    }
  }, [orderId, thumbnailId]);

  const loadMedia = useCallback(async () => {
    if (!orderId) return;
    const result = await askWhatsAppTab<MediaListReply>({ type: "list-media" });
    if (result.status !== "ok" || "error" in result.reply) return;
    if (title && sameTitle(result.reply.title, title)) setMedia(result.reply.items);
  }, [orderId, title]);

  const working = pipeline?.jobs.some(isActive) ?? false;
  usePolling(loadPipeline, working ? 5_000 : 15_000, enabled && Boolean(orderId));
  usePolling(loadMedia, 10_000, enabled && Boolean(orderId));

  if (!enabled || !open || !orderId || !title) return null;

  const run = async (key: string, task: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await task();
      if (message) setNotice(message);
      await loadPipeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: FilePayload, waMessageId: string | null) => {
    const result = await callBackground<UploadFileResponse>({
      type: "file-upload",
      orderId,
      kind: "original_cv",
      waMessageId,
      file,
    });
    if (result.duplicate) return "That file was already saved.";
    return result.job ? "Saved. Writing the CV in CV Studio now." : "Saved as the client's CV.";
  };

  const saveFromChat = (item: MediaMessage) =>
    run(`save-${item.wa_message_id}`, async () => {
      const read = await askWhatsAppTab<CaptureResult>({
        type: "capture-media",
        title,
        waMessageId: item.wa_message_id,
        kind: item.kind,
      });
      if (read.status !== "ok") throw new Error(TAB_PROBLEMS[read.status]);
      if (!read.reply.ok) throw new Error(read.reply.error);
      return upload(read.reply.file, item.wa_message_id);
    });

  const uploadChosen = (chosen: File | undefined) => {
    if (!chosen) return;
    void run("upload", async () => {
      if (chosen.size > MAX_FILE_BYTES) throw new Error("The file is larger than 15 MB.");
      return upload(
        {
          base64: bytesToBase64(await chosen.arrayBuffer()),
          mime: mimeFor(chosen.name, chosen.type),
          filename: chosen.name,
        },
        null,
      );
    });
  };

  const putPreviewInChat = (outboxId: string) =>
    run("paste", async () => {
      const taken = await callBackground<TakeOutboxResponse>({ type: "outbox-take", id: outboxId });
      const { file } = await previewImage(taken.file.id);
      const pasted = await askWhatsAppTab<PasteResult>({
        type: "paste-file",
        title,
        outboxId,
        file: { ...file, filename: taken.file.filename },
        caption: taken.caption,
      });
      if (pasted.status !== "ok") throw new Error(TAB_PROBLEMS[pasted.status]);
      if (!pasted.reply.ok) throw new Error(pasted.reply.error);
      return pasted.reply.captioned
        ? "It's in the chat with its caption. Check it and press send."
        : "It's in the chat. Add the caption if you want one, then press send.";
    });

  const saved = new Set(pipeline?.files.map((file) => file.source_wa_message_id) ?? []);
  const cvFiles = pipeline?.files.filter((file) => file.kind === "original_cv") ?? [];
  const cvJob = pipeline?.jobs.find((job) => job.type === "cv_draft");
  const previewJob = pipeline?.jobs.find((job) => job.type === "preview");
  const preview = pipeline?.preview ?? null;
  const shownThumbnail = preview && thumbnail?.fileId === preview.file_id ? thumbnail.url : null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold">CV &amp; preview</h2>

      {/* The client's files in this chat */}
      <div className="mt-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          Their files in this chat
        </p>
        {media.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            No photos or documents from them on screen. Scroll up to show older ones.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-gray-100">
            {media.map((item) => (
              <li
                key={item.wa_message_id}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="min-w-0 truncate text-xs">
                  {KIND_LABELS[item.kind]}
                  {item.filename ? ` · ${item.filename}` : ""}
                </span>
                {saved.has(item.wa_message_id) ? (
                  <span className="shrink-0 text-xs text-emerald-700">Saved</span>
                ) : (
                  <button
                    onClick={() => void saveFromChat(item)}
                    disabled={busy !== null}
                    className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-50"
                  >
                    {busy === `save-${item.wa_message_id}` ? "Saving…" : "Save as CV"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <label className="mt-1 inline-block cursor-pointer text-xs text-brand underline">
          {busy === "upload" ? "Uploading…" : "Or upload a file"}
          <input
            type="file"
            accept={CV_FILE_TYPES.join(",")}
            className="hidden"
            disabled={busy !== null}
            onChange={(event) => {
              uploadChosen(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {/* The CV in CV Studio */}
      <div className="mt-3 border-t border-gray-100 pt-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">CV</p>
        {cvJob && isActive(cvJob) ? (
          <p className="mt-1 text-xs text-gray-600">{JOBS.cv_draft}… this takes a few minutes.</p>
        ) : cvJob?.status === "failed" ? (
          <p className="mt-1 text-xs text-red-600">
            Couldn&apos;t write the CV: {reasonText(cvJob.last_error) ?? "unknown error"}
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-600">
            {pipeline?.cv_version
              ? `Version ${pipeline.cv_version} is in CV Studio.`
              : cvFiles.length > 0
                ? "Their CV is saved."
                : "Save their CV first."}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {cvFiles.length > 0 && !(cvJob && isActive(cvJob)) && !pipeline?.cv_version && (
            <button
              onClick={() =>
                void run("start", async () => {
                  await callBackground({ type: "start-cv", orderId, fileId: cvFiles[0]?.id });
                  return "Writing the CV in CV Studio.";
                })
              }
              disabled={busy !== null}
              className="rounded-md bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              Write the CV
            </button>
          )}
          {pipeline?.cv_studio_session_id && (
            <a
              href={`${dashboardUrl}/cv-studio?session=${pipeline.cv_studio_session_id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
            >
              Open in CV Studio
            </a>
          )}
        </div>
      </div>

      {/* The preview */}
      {Boolean(pipeline?.cv_version) && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Preview</p>
          {previewJob && isActive(previewJob) && (
            <p className="mt-1 text-xs text-gray-600">{JOBS.preview}…</p>
          )}
          {previewJob?.status === "failed" && !preview && (
            <p className="mt-1 text-xs text-red-600">
              Couldn&apos;t make the preview: {reasonText(previewJob.last_error) ?? "unknown error"}
            </p>
          )}
          {preview && (
            <div className="mt-1 space-y-1.5">
              {shownThumbnail && (
                <img
                  src={shownThumbnail}
                  alt="Watermarked preview of the CV"
                  className="max-h-60 w-full rounded border border-gray-200 object-contain object-top"
                />
              )}
              <p className="text-xs text-gray-600">
                {preview.status === "claimed"
                  ? "In the chat, waiting for you to press send."
                  : preview.status === "failed"
                    ? `Not sent: ${reasonText(preview.failure_reason) ?? "try again"}.`
                    : "Ready to send."}
              </p>
              <button
                onClick={() => void putPreviewInChat(preview.id)}
                disabled={busy !== null}
                className="w-full rounded-md bg-brand px-2 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {busy === "paste" ? "Putting it in the chat…" : "Put preview in chat"}
              </button>
            </div>
          )}
          {!(previewJob && isActive(previewJob)) && (
            <button
              onClick={() =>
                void run("preview", async () => {
                  await callBackground({ type: "create-preview", orderId });
                  return `Making the preview of version ${pipeline?.cv_version}.`;
                })
              }
              disabled={busy !== null}
              className="mt-1.5 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
            >
              {preview ? "Make a new preview" : `Make preview (version ${pipeline?.cv_version})`}
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}
