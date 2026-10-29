import { useCallback, useState } from "react";
import { callBackground } from "../../src/bridge";
import { usePolling } from "../../src/ui/usePolling";
import type { EventListResponse, WhatsAppEvent } from "../../src/shared/contract";
import { ago, eventText, reasonText } from "../../src/ui/labels";

/** The latest things the assistant did */
export function Activity({ enabled }: { enabled: boolean }) {
  const [events, setEvents] = useState<WhatsAppEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await callBackground<EventListResponse>({ type: "events-list" });
      setEvents(result.events);
    } catch {
      // The connection row already explains why
    }
  }, []);

  usePolling(load, 20_000, enabled);

  if (!enabled || events.length === 0) return null;

  return (
    <details className="rounded-lg border border-gray-200 bg-white p-3" open>
      <summary className="cursor-pointer text-sm font-semibold">Activity</summary>
      <ul className="mt-2 space-y-1.5">
        {events.slice(0, 15).map((event) => {
          const reason =
            typeof event.data.reason === "string" ? reasonText(event.data.reason) : null;
          return (
            <li key={event.id} className="flex justify-between gap-2 text-xs">
              <span
                className={
                  event.severity === "error"
                    ? "text-red-600"
                    : event.severity === "warn"
                      ? "text-amber-700"
                      : ""
                }
              >
                {eventText(event.type)}
                {reason && <span className="text-gray-500"> · {reason}</span>}
              </span>
              <span className="shrink-0 text-gray-400">{ago(event.created_at)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
