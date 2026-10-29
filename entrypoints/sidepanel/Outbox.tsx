import { useCallback, useState } from "react";
import { callBackground } from "../../src/bridge";
import { usePolling } from "../../src/ui/usePolling";
import type { OutboxItem } from "../../src/shared/contract";
import { ago, reasonText } from "../../src/ui/labels";

const KIND: Record<string, string> = {
  pricing: "Pricing",
  request_cv: "CV request",
  payment_details: "Payment details",
  reply: "Reply",
  preview: "Preview",
  final_pdf: "Final CV",
};

function countdown(iso: string | null, now: number): string {
  if (!iso) return "soon";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (seconds <= 0) return "when you're idle";
  return seconds < 90 ? `in ${seconds} s` : `in ${Math.round(seconds / 60)} min`;
}

/** Messages waiting for my approval, and messages scheduled to go out */
export function Outbox({ enabled }: { enabled: boolean }) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setItems(await callBackground<OutboxItem[]>({ type: "outbox-list" }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the queue");
    }
  }, []);

  usePolling(load, 10_000, enabled);
  usePolling(() => setNow(Date.now()), 1_000, enabled);

  const act = async (id: string, type: "outbox-approve" | "outbox-cancel") => {
    setBusy(id);
    try {
      await callBackground({ type, id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(null);
      await load();
    }
  };

  const sendAll = async (waiting: OutboxItem[]) => {
    setBusy("all");
    try {
      // One by one: the backend spaces them out with random gaps
      for (const item of waiting) await callBackground({ type: "outbox-approve", id: item.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!enabled) return null;

  const waiting = items.filter(
    (item) => item.status === "needs_approval" || item.status === "failed",
  );
  const scheduled = items.filter(
    (item) => item.status === "scheduled" || item.status === "claimed",
  );

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Waiting for you ({waiting.length})</h2>
        {waiting.length > 1 && (
          <button
            onClick={() => void sendAll(waiting.filter((item) => item.status === "needs_approval"))}
            disabled={busy !== null}
            className="text-xs text-brand underline disabled:opacity-50"
          >
            Send all
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {waiting.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">Nothing waiting.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {waiting.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {item.contact.title}
                  {item.contact.is_test && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">
                      TEST
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  {KIND[item.kind] ?? item.kind} · {ago(item.created_at, now)}
                </p>
                {item.status === "failed" && (
                  <p className="text-xs text-red-600">{reasonText(item.failure_reason)}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => void act(item.id, "outbox-approve")}
                  disabled={busy !== null}
                  className="rounded bg-brand px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  {item.status === "failed" ? "Retry" : "Send"}
                </button>
                <button
                  onClick={() => void act(item.id, "outbox-cancel")}
                  disabled={busy !== null}
                  className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {scheduled.length > 0 && (
        <>
          <h2 className="mt-3 text-sm font-semibold">Scheduled ({scheduled.length})</h2>
          <ul className="mt-1 divide-y divide-gray-100">
            {scheduled.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{item.contact.title}</p>
                  <p className="text-xs text-gray-500">
                    {KIND[item.kind] ?? item.kind} ·{" "}
                    {item.status === "claimed" ? "sending…" : countdown(item.not_before, now)}
                  </p>
                </div>
                {item.status === "scheduled" && (
                  <button
                    onClick={() => void act(item.id, "outbox-cancel")}
                    disabled={busy !== null}
                    className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
