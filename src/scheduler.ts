import type { OutboxItem } from "./shared/contract";
import type { SendOutcome } from "./sender";

/**
 * Holds the scheduled messages and runs them one at a time when due.
 * The backend is the source of truth: the list is re-synced every minute,
 * so approvals, cancellations and restarts all converge.
 */
export class SendScheduler {
  private readonly due = new Map<string, { item: OutboxItem; at: number }>();
  private busy = false;

  constructor(
    private readonly run: (item: OutboxItem) => Promise<SendOutcome>,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Add or refresh an item; only scheduled (or abandoned claimed) items run */
  upsert(item: OutboxItem): void {
    if (item.status !== "scheduled" && item.status !== "claimed") {
      this.due.delete(item.id);
      return;
    }
    const at = item.not_before ? new Date(item.not_before).getTime() : this.now();
    const current = this.due.get(item.id);
    // Keep a later local retry time rather than hammering the backend
    this.due.set(item.id, { item, at: current ? Math.max(current.at, at) : at });
  }

  /** Make the local list match the backend's */
  sync(items: OutboxItem[]): void {
    const ids = new Set(items.map((item) => item.id));
    for (const id of this.due.keys()) if (!ids.has(id)) this.due.delete(id);
    items.forEach((item) => this.upsert(item));
  }

  /** Forget everything for a chat (e.g. I replied to it myself) */
  removeChat(title: string): void {
    for (const [id, entry] of this.due) if (entry.item.contact.title === title) this.due.delete(id);
  }

  get size(): number {
    return this.due.size;
  }

  /** Run the earliest due item, if any and if nothing is running */
  async tick(): Promise<SendOutcome | null> {
    if (this.busy) return null;
    const now = this.now();
    let next: { item: OutboxItem; at: number } | null = null;
    for (const entry of this.due.values()) {
      if (entry.at <= now && (!next || entry.at < next.at)) next = entry;
    }
    if (!next) return null;

    this.busy = true;
    try {
      const outcome = await this.run(next.item);
      if (outcome.kind === "retry") next.at = this.now() + outcome.afterMs;
      else this.due.delete(next.item.id);
      return outcome;
    } catch (error) {
      next.at = this.now() + 60_000;
      this.onError(error);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
