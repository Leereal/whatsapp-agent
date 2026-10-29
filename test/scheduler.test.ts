import { SendScheduler } from "../src/scheduler";
import type { SendOutcome } from "../src/sender";
import type { OutboxItem } from "../src/shared/contract";

let clock = 1_000_000;
const now = () => clock;

const item = (id: string, notBeforeOffsetMs: number, title = id): OutboxItem => ({
  id,
  kind: "pricing",
  status: "scheduled",
  auto: true,
  not_before: new Date(clock + notBeforeOffsetMs).toISOString(),
  failure_reason: null,
  created_at: new Date(clock).toISOString(),
  contact: { id: `c-${id}`, title, phone: null, is_test: false },
});

const sent: SendOutcome = { kind: "done", status: "sent" };

describe("SendScheduler", () => {
  beforeEach(() => {
    clock = 1_000_000;
  });

  it("runs nothing before it is due", async () => {
    const run = vi.fn(async () => sent);
    const scheduler = new SendScheduler(run, undefined, now);
    scheduler.upsert(item("a", 30_000));

    expect(await scheduler.tick()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the earliest due item first, one at a time", async () => {
    const order: string[] = [];
    const scheduler = new SendScheduler(
      async (entry) => {
        order.push(entry.id);
        return sent;
      },
      undefined,
      now,
    );
    scheduler.upsert(item("late", -1_000));
    scheduler.upsert(item("early", -5_000));

    await scheduler.tick();
    await scheduler.tick();
    expect(order).toEqual(["early", "late"]);
    expect(scheduler.size).toBe(0);
  });

  it("reschedules on retry and drops finished items", async () => {
    const outcomes: SendOutcome[] = [
      { kind: "retry", afterMs: 15_000, reason: "user_active" },
      { kind: "done", status: "skipped" },
    ];
    const run = vi.fn(async () => outcomes.shift()!);
    const scheduler = new SendScheduler(run, undefined, now);
    scheduler.upsert(item("a", 0));

    await scheduler.tick();
    expect(scheduler.size).toBe(1);
    expect(await scheduler.tick()).toBeNull(); // not due again yet

    clock += 15_000;
    await scheduler.tick();
    expect(scheduler.size).toBe(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("waits a minute after an unexpected error", async () => {
    const onError = vi.fn();
    const run = vi.fn(async () => {
      throw new Error("offline");
    });
    const scheduler = new SendScheduler(run, onError, now);
    scheduler.upsert(item("a", 0));

    await scheduler.tick();
    expect(onError).toHaveBeenCalled();
    clock += 59_000;
    expect(await scheduler.tick()).toBeNull();
  });

  it("follows the backend's list and forgets chats I reply to", () => {
    const scheduler = new SendScheduler(async () => sent, undefined, now);
    scheduler.upsert(item("a", 0, "+27 71 000 5678"));
    scheduler.upsert(item("b", 0, "+27 82 123 4567"));

    scheduler.sync([item("b", 0, "+27 82 123 4567"), item("c", 0, "+27 72 048 7867")]);
    expect(scheduler.size).toBe(2);

    scheduler.removeChat("+27 82 123 4567");
    expect(scheduler.size).toBe(1);

    scheduler.upsert({ ...item("c", 0), status: "cancelled" });
    expect(scheduler.size).toBe(0);
  });
});
