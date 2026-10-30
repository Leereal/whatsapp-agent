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

/** Their own files for the CV, however they were saved */
const CLIENT_KINDS = new Set(["original_cv", "other", "profile_photo"]);

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

  const cvJob = pipeline?.jobs.find((job) => job.type === "cv_draft");
  const writing = Boolean(cvJob && isActive(cvJob));
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

  // Their saved files, by the chat message they came from
  const savedIds = new Set(
    pipeline?.files
      .filter((file) => CLIENT_KINDS.has(file.kind))
      .map((file) => file.source_wa_message_id) ?? [],
  );
  const savedCount = pipeline?.files.filter((file) => CLIENT_KINDS.has(file.kind)).length ?? 0;
  const unsaved = media.filter((item) => !savedIds.has(item.wa_message_id));

  const upload = (file: FilePayload, waMessageId: string | null) =>
    callBackground<UploadFileResponse>({
      type: "file-upload",
      orderId,
      // CV pages, certificates and their photo alike: the CV job tells them apart
      kind: "original_cv",
      waMessageId,
      file,
    });

  /** Show their long messages in full and send the chat, so the CV uses all they typed */
  const readChat = async () => {
    const read = await askWhatsAppTab<CvChatReply>({ type: "read-chat-for-cv", title });
    if (read.status !== "ok") throw new Error(TAB_PROBLEMS[read.status]);
    if (!read.reply.ok) throw new Error(read.reply.error);
  };

  /** Save every file of theirs in the chat that isn't saved yet; returns what couldn't be read */
  const saveAllFromChat = async (): Promise<{ saved: number; problems: string[] }> => {
    let saved = 0;
    const problems: string[] = [];
    for (const item of unsaved) {
      const read = await askWhatsAppTab<CaptureResult>({
        type: "capture-media",
        title,
        waMessageId: item.wa_message_id,
        kind: item.kind,
      });
      if (read.status !== "ok") problems.push(TAB_PROBLEMS[read.status]);
      else if (!read.reply.ok) problems.push(read.reply.error);
      else {
        await upload(read.reply.file, item.wa_message_id);
        saved += 1;
      }
    }
    return { saved, problems };
  };

  const savedText = ({ saved, problems }: { saved: number; problems: string[] }) =>
    [
      saved > 0 ? `${plural(saved, "file")} saved.` : "",
      problems.length > 0
        ? `${plural(problems.length, "file")} couldn't be saved: ${problems[0]}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

  /** One click: choose where it's written, save their files, read the chat, write the CV */
  const writeCv = (choice: CvEngine) =>
    run(`write-${choice}`, async () => {
      if (choice !== engine) {
        await callBackground({ type: "set-cv-engine", orderId, engine: choice });
      }
      const result = await saveAllFromChat();
      await readChat();
      await callBackground({ type: "start-cv", orderId });
      return `Writing the CV in ${ENGINE_NAMES[choice]} from their files and your chat. ${savedText(result)}`.trim();
    });

  const updateCv = () =>
    run("update", async () => {
      const result = await saveAllFromChat();
      // Messages the panel hasn't seen yet may be on screen
      await readChat();
      await callBackground({ type: "update-cv", orderId });
      return `Updating the CV with what they sent. ${savedText(result)}`.trim();
    });

  const uploadChosen = (chosen: File | undefined) => {
    if (!chosen) return;
    void run("upload", async () => {
      if (chosen.size > MAX_FILE_BYTES) throw new Error("The file is larger than 15 MB.");
      const result = await upload(
        {
          base64: bytesToBase64(await chosen.arrayBuffer()),
          mime: mimeFor(chosen.name, chosen.type),
          filename: chosen.name,
        },
        null,
      );
      return result.duplicate ? "That file was already saved." : "Saved with their other files.";
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

  const previewJob = pipeline?.jobs.find((job) => job.type === "preview");
  const preview = pipeline?.preview ?? null;
  const shownThumbnail = preview && thumbnail?.fileId === preview.file_id ? thumbnail.url : null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold">CV &amp; preview</h2>

      {/* The client's files: all of them go into the CV */}
      <div className="mt-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Their files</p>
        {media.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            {savedCount > 0
              ? `${plural(savedCount, "file")} saved. Scroll up in the chat to see them.`
              : "No photos or documents from them on screen. Scroll up to show older ones."}
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {media.map((item) => (
              <li
                key={item.wa_message_id}
                className="relative"
                title={`${KIND_LABELS[item.kind]}${item.filename ? ` · ${item.filename}` : ""}${savedIds.has(item.wa_message_id) ? " (saved)" : ""}`}
              >
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="h-12 w-12 rounded border border-gray-200 object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50 px-0.5 text-center text-[9px] leading-tight text-gray-600">
                    {item.filename ?? KIND_LABELS[item.kind]}
                  </span>
                )}
                {savedIds.has(item.wa_message_id) && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-emerald-600 px-1 text-[9px] text-white">
                    ✓
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {unsaved.length > 0
            ? `Writing the CV saves ${unsaved.length === 1 ? "it" : `all ${unsaved.length}`}; a photo of them goes on the CV. `
            : media.length > 0
              ? "All saved; a photo of them goes on the CV. "
              : ""}
          <label className="cursor-pointer text-brand underline">
            {busy === "upload" ? "Uploading…" : "Add a file"}
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
        </p>
      </div>

      {/* The CV, in CV Builder or CV Studio */}
      <div className="mt-3 border-t border-gray-100 pt-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">CV</p>
        {writing ? (
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
              : "One click saves their files, reads your chat and writes the CV."}
          </p>
        )}
        {Boolean(pipeline?.cv_version) && changes && !writing && (
          <p className="mt-1 text-xs text-gray-600">{changesText(changes)}</p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {!pipeline?.cv_version && !writing && pipeline && (
            <>
              {(["cv_builder", "cv_studio"] as const).map((choice) => (
                <button
                  key={choice}
                  onClick={() => void writeCv(choice)}
                  disabled={busy !== null}
                  className={
                    choice === "cv_builder"
                      ? "rounded-md bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
                      : "rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
                  }
                >
                  {busy === `write-${choice}`
                    ? "Saving and writing…"
                    : `Write in ${ENGINE_NAMES[choice]}`}
                </button>
              ))}
            </>
          )}
          {waitMinutes > 0 && (
            <button
              onClick={() => void writeCv(engine)}
              disabled={busy !== null}
              className="rounded-md bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              Start now
            </button>
          )}
          {Boolean(pipeline?.cv_version) && changes && !writing && (
            <button
              onClick={() => void updateCv()}
              disabled={busy !== null}
              title="Saves their new files, then applies their new messages and files to the CV"
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
        {/* Once written: switch to write it again in the other one */}
        {Boolean(pipeline?.cv_version) && (
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
