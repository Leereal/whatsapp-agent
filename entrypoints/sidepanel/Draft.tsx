import { useState } from "react";
import { callBackground } from "../../src/bridge";
import { sameTitle } from "../../src/dom/chat";
import type { InsertReply, OpenChatReply } from "../../src/messages";
import {
  TEMPLATE_ACTIONS,
  type CurrentChat,
  type DraftAction,
  type DraftOutcome,
  type DraftResponse,
  type TemplateKind,
} from "../../src/shared/contract";
import { openChatState } from "../../src/storage";
import { INTENTS, policyText, PRODUCTS, STAGES } from "../../src/ui/labels";
import { useStorageItem } from "../../src/ui/useStorageItem";
import { askWhatsAppTab, TAB_PROBLEMS } from "../../src/ui/whatsappTab";

const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  pricing: "Pricing message",
  request_cv: "CV request",
  payment_details: "Payment details",
};

function actionLabel(action: DraftAction): string {
  switch (action.type) {
    case "set_product":
      return `Product: ${PRODUCTS[action.product ?? ""] ?? action.product}`;
    case "update_order_stage":
      return `Move to ${STAGES[action.stage ?? ""] ?? action.stage}`;
    case "flag_pop_received":
      return "Record proof of payment (not paid yet)";
    default:
      return action.type.replace(/_/g, " ");
  }
}

const templateKind = (action: DraftAction): TemplateKind | null =>
  action.type in TEMPLATE_ACTIONS
    ? TEMPLATE_ACTIONS[action.type as keyof typeof TEMPLATE_ACTIONS]
    : null;

function ChatSummary({
  chat,
  known,
  onCloseHandoff,
  busy,
}: {
  chat: CurrentChat | null;
  known: boolean;
  onCloseHandoff: (contactId: string) => void;
  busy: boolean;
}) {
  if (!known || !chat) {
    return (
      <p className="mt-1 text-xs text-gray-500">
        Not a client chat yet. Drafting a reply adds it to CareerCVPro.
      </p>
    );
  }
  const { contact, order } = chat;
  return (
    <div className="mt-1 space-y-1.5">
      <div className="flex flex-wrap gap-1 text-[11px]">
        <span className="rounded bg-gray-100 px-1.5 py-0.5">
          {order ? STAGES[order.stage] : "No open order"}
        </span>
        {order?.product && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5">{PRODUCTS[order.product]}</span>
        )}
        {order?.pop_received_at && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
            Proof of payment received
          </span>
        )}
        {contact.is_test && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">TEST</span>
        )}
      </div>
      {contact.handoff_open && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <span>Handed to you: automation is off for this chat.</span>
          <button
            onClick={() => onCloseHandoff(contact.id)}
            disabled={busy}
            className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 disabled:opacity-50"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/** The open chat, and an AI draft of my reply that I check, edit and send */
export function Draft({ enabled }: { enabled: boolean }) {
  const { value: open } = useStorageItem(openChatState);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [chat, setChat] = useState<CurrentChat | null>(null);
  const [applied, setApplied] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [shownTitle, setShownTitle] = useState<string | null>(null);

  const reset = () => {
    setDraft(null);
    setDraftTitle(null);
    setText("");
    setApplied([]);
  };

  // A draft belongs to its chat: switching chats drops it
  const openTitle = open?.title ?? null;
  if (openTitle !== shownTitle) {
    setShownTitle(openTitle);
    if (draftTitle && (!openTitle || !sameTitle(openTitle, draftTitle))) reset();
    setChat(null);
    setError(null);
    setNotice(null);
  }

  if (!enabled) return null;

  const current = chat ?? open?.chat ?? null;

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  };

  const report = (outcome: DraftOutcome, finalText?: string) =>
    draft
      ? callBackground({
          type: "draft-outcome",
          id: draft.id,
          outcome: { outcome, ...(finalText ? { final_text: finalText } : {}) },
        }).catch(() => undefined)
      : Promise.resolve();

  const createDraft = () =>
    run("draft", async () => {
      if (draft) await report("discarded");
      const read = await askWhatsAppTab<OpenChatReply>({ type: "read-open-chat" });
      if (read.status !== "ok") throw new Error(TAB_PROBLEMS[read.status]);
      if ("error" in read.reply) throw new Error(read.reply.error);

      const result = await callBackground<DraftResponse>({ type: "draft-create", ...read.reply });
      setDraft(result);
      setDraftTitle(read.reply.title);
      setText(result.text);
      setChat(result.chat);
      setApplied([]);
    });

  const insert = (send: boolean) =>
    run(send ? "send" : "insert", async () => {
      if (!draft || !draftTitle) return;
      const finalText = text.trim();
      if (!finalText) throw new Error("The reply is empty.");

      const result = await askWhatsAppTab<InsertReply>({
        type: "insert-draft",
        title: draftTitle,
        text: finalText,
        send,
      });
      if (result.status !== "ok") throw new Error(TAB_PROBLEMS[result.status]);
      if (!result.reply.ok) throw new Error(result.reply.error);

      const edited = finalText !== draft.text.trim();
      await report(edited ? "edited" : send ? "sent" : "inserted", edited ? finalText : undefined);
      reset();
      setNotice(send ? "Sent." : "It's in the message box. Check it and press Enter.");
    });

  const discard = () =>
    run("discard", async () => {
      await report("discarded");
      reset();
    });

  const apply = (index: number) =>
    run(`apply-${index}`, async () => {
      if (!draft) return;
      setChat(
        await callBackground<CurrentChat>({ type: "draft-apply", id: draft.id, actionIndex: index }),
      );
      setApplied((done) => [...done, index]);
    });

  const addTemplate = (kind: TemplateKind) => {
    const template = draft?.templates[kind];
    if (!template) return;
    setText((value) => (value.trim() ? `${value.trim()}\n\n${template}` : template));
  };

  const closeHandoff = (contactId: string) =>
    void run("handoff", async () => {
      setChat(await callBackground<CurrentChat>({ type: "handoff-close", contactId }));
    });

  const filtered = draft ? policyText(draft.policy_flags) : null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Reply</h2>
        {open && <span className="truncate text-xs text-gray-500">{open.title}</span>}
      </div>

      {!open ? (
        <p className="mt-1 text-xs text-gray-500">Open a chat in WhatsApp to draft a reply.</p>
      ) : (
        <>
          <ChatSummary
            chat={current}
            known={open.known || Boolean(chat)}
            onCloseHandoff={closeHandoff}
            busy={busy !== null}
          />

          {draft ? (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-gray-500">
                {INTENTS[draft.intent] ?? draft.intent} · {Math.round(draft.confidence * 100)}% sure
                {draft.tier !== draft.tier_requested && " · Basic was used"}
              </p>
              {draft.handoff.required && (
                <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  Handle this one yourself{draft.handoff.reason ? `: ${draft.handoff.reason}` : ""}.
                  Automation is off for this chat.
                </p>
              )}
              {filtered && (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">{filtered}</p>
              )}
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
                className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-brand focus:outline-none"
                aria-label="Draft reply"
              />
              {draft.actions.length > 0 && (
                <ul className="space-y-1">
                  {draft.actions.map((action, index) => {
                    const kind = templateKind(action);
                    const done = applied.includes(index);
                    return (
                      <li key={`${action.type}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0">
                          <span className="font-medium">
                            {kind ? TEMPLATE_LABELS[kind] : actionLabel(action)}
                          </span>
                          {action.reason && <span className="text-gray-500"> · {action.reason}</span>}
                        </span>
                        {kind ? (
                          <button
                            onClick={() => addTemplate(kind)}
                            disabled={busy !== null || text.includes(draft.templates[kind] ?? "\u0000")}
                            className="shrink-0 rounded border border-gray-300 px-2 py-0.5 disabled:opacity-50"
                          >
                            Add
                          </button>
                        ) : done ? (
                          <span className="shrink-0 text-emerald-700">Done</span>
                        ) : (
                          <button
                            onClick={() => void apply(index)}
                            disabled={busy !== null}
                            className="shrink-0 rounded border border-gray-300 px-2 py-0.5 disabled:opacity-50"
                          >
                            Apply
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex gap-1.5">
                <button
                  onClick={() => void insert(false)}
                  disabled={busy !== null || !text.trim()}
                  className="flex-1 rounded-md bg-brand px-2 py-1.5 text-xs text-white disabled:opacity-50"
                  title="Put it in the message box; you press Enter"
                >
                  {busy === "insert" ? "Inserting…" : "Insert"}
                </button>
                <button
                  onClick={() => void insert(true)}
                  disabled={busy !== null || !text.trim()}
                  className="flex-1 rounded-md border border-brand px-2 py-1.5 text-xs text-brand disabled:opacity-50"
                >
                  {busy === "send" ? "Sending…" : "Send"}
                </button>
                <button
                  onClick={() => void createDraft()}
                  disabled={busy !== null}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  {busy === "draft" ? "…" : "Again"}
                </button>
                <button
                  onClick={() => void discard()}
                  disabled={busy !== null}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => void createDraft()}
              disabled={busy !== null}
              className="mt-2 w-full rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "draft" ? "Writing a draft…" : "Draft a reply"}
            </button>
          )}
        </>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
    </section>
  );
}
