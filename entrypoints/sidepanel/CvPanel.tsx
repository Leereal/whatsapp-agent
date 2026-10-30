import { useCallback, useState } from "react";
import { bytesToBase64, mimeFor, type FilePayload } from "../../src/bytes";
import { callBackground } from "../../src/bridge";
import { sameTitle } from "../../src/dom/chat";
import type { CaptureResult, MediaMessage, PasteResult } from "../../src/dom/media";
import type { CvChatReply, MediaListReply } from "../../src/messages";
import {
  CV_FILE_TYPES,
  MAX_FILE_BYTES,
  type CvChanges,
  type CvEngine,
  type OrderPipeline,
  type TakeOutboxResponse,
  type UploadFileKind,
  type UploadFileResponse,
  type WhatsAppJob,
} from "../../src/shared/contract";
import { openChatState } from "../../src/storage";
import { JOBS, reasonText } from "../../src/ui/labels";
import { usePolling } from "../../src/ui/usePolling";
import { useStorageItem } from "../../src/ui/useStorageItem";
import { askWhatsAppTab, TAB_PROBLEMS } from "../../src/ui/whatsappTab";

const isActive = (job: WhatsAppJob) => job.status === "queued" || job.status === "running";

/** Minutes until a queued job starts; 0 when it's due (autostart waits for more files) */
const minutesToStart = (job: WhatsAppJob) =>
  job.status === "queued"
    ? Math.max(0, Math.ceil((Date.parse(job.run_after) - Date.now()) / 60_000))
    : 0;

const KIND_LABELS = { image: "Photo", document: "Document" } as const;

const ENGINE_NAMES: Record<CvEngine, string> = { cv_builder: "CV Builder", cv_studio: "CV Studio" };

const SAVED_AS: Partial<Record<string, string>> = {
  original_cv: "Saved as CV",
  other: "Saved as certificate / other",
  profile_photo: "Saved as their photo",
};

/** How a file in the chat can be saved: as (part of) their CV, a supporting document, or their photo (photos only) */
const SAVE_AS: { kind: UploadFileKind; label: string; title: string }[] = [
  { kind: "original_cv", label: "CV", title: "Their CV, or one page of it" },
  {
    kind: "other",
    label: "Certificate / other",
    title: "A certificate, ID, reference letter or other document, read with their CV",
  },
  { kind: "profile_photo", label: "Photo", title: "The photo they want on their CV" },
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function changesText(changes: CvChanges): string {
  const parts = [
    changes.messages > 0 ? plural(changes.messages, "new message") : null,
    changes.files > 0 ? plural(changes.files, "new file") : null,
  ].filter(Boolean);
  return parts.length > 0
    ? `Since it was written: ${parts.join(" and ")} from them.`
    : "Nothing new from them since it was written.";
}

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
 * The open client chat's CV work: save the CV and certificates they sent,
 * have CV Studio write it from them and our chat, update it with what they
 * send later, make the watermarked preview and put it in the chat for me to
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

  const upload = async (file: FilePayload, waMessageId: string | null, kind: UploadFileKind) => {
    const result = await callBackground<UploadFileResponse>({
      type: "file-upload",
      orderId,
      kind,
      waMessageId,
      file,
    });
    if (result.duplicate) return "That file was already saved.";
    if (kind === "other") return "Saved. It's read with their CV.";
    if (kind === "profile_photo") return "Saved. It goes on their CV.";
    return result.job
      ? "Saved as their CV. Writing starts in about 2 minutes, so save their other files now."
      : "Saved as their CV.";
  };

  /** Show their long messages in full and send the chat, so the CV uses all they typed */
  const readChat = async () => {
    const read = await askWhatsAppTab<CvChatReply>({ type: "read-chat-for-cv", title });
    if (read.status !== "ok") throw new Error(TAB_PROBLEMS[read.status]);
    if (!read.reply.ok) throw new Error(read.reply.error);
  };

  const saveFromChat = (item: MediaMessage, kind: UploadFileKind) =>
    run(`save-${item.wa_message_id}`, async () => {
      const read = await askWhatsAppTab<CaptureResult>({
        type: "capture-media",
        title,
        waMessageId: item.wa_message_id,
        kind: item.kind,
      });
      if (read.status !== "ok") throw new Error(TAB_PROBLEMS[read.status]);
      if (!read.reply.ok) throw new Error(read.reply.error);
      const saved = await upload(read.reply.file, item.wa_message_id, kind);
      // Their messages around the file usually say what it's for
      await readChat().catch(() => undefined);
      return saved;
    });

  const uploadChosen = (chosen: File | undefined, kind: UploadFileKind) => {
    if (!chosen) return;
    void run(`upload-${kind}`, async () => {
      if (chosen.size > MAX_FILE_BYTES) throw new Error("The file is larger than 15 MB.");
      return upload(
        {
          base64: bytesToBase64(await chosen.arrayBuffer()),
          mime: mimeFor(chosen.name, chosen.type),
          filename: chosen.name,
        },
        null,
        kind,
      );
    });
  };

  const uploadLink = (kind: UploadFileKind, label: string) => (
    <label className="cursor-pointer text-xs text-brand underline">
      {busy === `upload-${kind}` ? "Uploading…" : label}
      <input
        type="file"
        accept={
          kind === "profile_photo" ? "image/jpeg,image/png,image/webp" : CV_FILE_TYPES.join(",")
        }
        className="hidden"
        disabled={busy !== null}
        onChange={(event) => {
          uploadChosen(event.target.files?.[0], kind);
          event.target.value = "";
        }}
      />
    </label>
  );

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

  const savedKinds = new Map(
    pipeline?.files.map((file) => [file.source_wa_message_id, file.kind] as const) ?? [],
  );
  const cvCount = pipeline?.files.filter((file) => file.kind === "original_cv").length ?? 0;
  const otherCount = pipeline?.files.filter((file) => file.kind === "other").length ?? 0;
  const hasPhoto = pipeline?.files.some((file) => file.kind === "profile_photo") ?? false;
  const cvJob = pipeline?.jobs.find((job) => job.type === "cv_draft");
  const waitMinutes = cvJob ? minutesToStart(cvJob) : 0;
  // Older backends don't report changes, or where the CV is written (CV Studio then)
  const changes = pipeline?.changes ?? null;
  const engine: CvEngine = pipeline?.engine ?? "cv_studio";
  const cvLink =
    engine === "cv_builder"
      ? pipeline?.resume_id
        ? `/cv-builder?id=${pipeline.resume_id}`
        : null
      : pipeline?.cv_studio_session_id
        ? `/cv-studio?session=${pipeline.cv_studio_session_id}`
        : null;
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
                {savedKinds.has(item.wa_message_id) ? (
                  <span className="shrink-0 text-xs text-emerald-700">
                    {SAVED_AS[savedKinds.get(item.wa_message_id) ?? ""] ?? "Saved"}
                  </span>
                ) : busy === `save-${item.wa_message_id}` ? (
                  <span className="shrink-0 text-xs text-gray-500">Saving…</span>
                ) : (
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {SAVE_AS.filter(
                      (option) => item.kind === "image" || option.kind !== "profile_photo",
                    ).map((option) => (
                      <button
                        key={option.kind}
                        onClick={() => void saveFromChat(item, option.kind)}
                        disabled={busy !== null}
                        title={option.title}
                        className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-50"
                      >
                        {option.label}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
          Or upload: {uploadLink("original_cv", "a CV")}
          {uploadLink("other", "a certificate / other")}
          {uploadLink("profile_photo", "their photo")}
        </p>
      </div>

      {/* The CV in CV Studio */}
      <div className="mt-3 border-t border-gray-100 pt-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">CV</p>
        {(cvCount > 0 || otherCount > 0 || hasPhoto) && (
          <p className="mt-1 text-xs text-gray-500">
            Saved:{" "}
            {[
              cvCount > 0 && plural(cvCount, "CV file"),
              otherCount > 0 && plural(otherCount, "other document"),
              hasPhoto && "their photo",
            ]
              .filter(Boolean)
              .join(", ")}
            . They&apos;re all read, with your chat.
          </p>
        )}
        {cvJob && isActive(cvJob) ? (
          <p className="mt-1 text-xs text-gray-600">
            {waitMinutes > 0
              ? `Starts writing in about ${plural(waitMinutes, "minute")}, so their other files can be saved first.`
              : `${JOBS.cv_draft}… this takes a few minutes.`}
          </p>
        ) : cvJob?.status === "failed" ? (
          <p className="mt-1 text-xs text-red-600">
            Couldn&apos;t write the CV: {reasonText(cvJob.last_error) ?? "unknown error"}
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-600">
            {pipeline?.cv_version
              ? engine === "cv_builder"
                ? "It's in CV Builder (Executive Teal)."
                : `Version ${pipeline.cv_version} is in CV Studio.`
              : cvCount + otherCount > 0
                ? "Ready to write."
                : "Save their CV, or write it from what they typed in the chat."}
          </p>
        )}
        {Boolean(pipeline?.cv_version) && changes && !(cvJob && isActive(cvJob)) && (
          <p className="mt-1 text-xs text-gray-600">{changesText(changes)}</p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {!pipeline?.cv_version && (!(cvJob && isActive(cvJob)) || waitMinutes > 0) && (
            <button
              onClick={() =>
                void run("start", async () => {
                  await readChat();
                  await callBackground({ type: "start-cv", orderId });
                  return `Writing the CV in ${ENGINE_NAMES[engine]} from their files and your chat.`;
                })
              }
              disabled={busy !== null}
              className="rounded-md bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              {waitMinutes > 0 ? "Start now" : "Write the CV"}
            </button>
          )}
          {Boolean(pipeline?.cv_version) && changes && !(cvJob && isActive(cvJob)) && (
            <button
              onClick={() =>
                void run("update", async () => {
                  // Messages the panel hasn't seen yet may be on screen
                  await readChat();
                  await callBackground({ type: "update-cv", orderId });
                  return "Updating the CV with what they sent.";
                })
              }
              disabled={busy !== null}
              title="Applies their new messages and files to the CV"
              className="rounded-md bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              {busy === "update" ? "Starting…" : "Update CV from chat"}
            </button>
          )}
          {cvLink && (
            <a
              href={`${dashboardUrl}${cvLink}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
            >
              Open in {ENGINE_NAMES[engine]}
            </a>
          )}
        </div>
        {/* Where it's written: CV Builder by default */}
        {pipeline && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
            <span>Written in</span>
            <span className="inline-flex rounded border border-gray-300 p-0.5">
              {(["cv_builder", "cv_studio"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() =>
                    void run(`engine-${option}`, async () => {
                      await callBackground({ type: "set-cv-engine", orderId, engine: option });
                      return `The CV is written in ${ENGINE_NAMES[option]} now.`;
                    })
                  }
                  disabled={busy !== null || engine === option || Boolean(cvJob && isActive(cvJob))}
                  className={`rounded px-1.5 py-0.5 ${
                    engine === option ? "bg-brand text-white" : "text-gray-600"
                  }`}
                >
                  {ENGINE_NAMES[option]}
                </button>
              ))}
            </span>
          </div>
        )}
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
