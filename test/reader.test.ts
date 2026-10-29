import { PageLock } from "../src/pageLock";
import { ChatReader, type ReadOutcome } from "../src/reader";

let clock = 1_000_000;
const now = () => clock;

const scheduled: ReadOutcome = { kind: "done", result: "scheduled" };

describe("ChatReader", () => {
  beforeEach(() => {
    clock = 1_000_000;
  });

  it("reads each chat once, however often the scan asks", async () => {
    const run = vi.fn(async () => scheduled);
    const reader = new ChatReader(run, undefined, now);
    reader.add("Thandi");
    reader.add("Thandi");
    expect(reader.size).toBe(1);

    await reader.tick();
    expect(run).toHaveBeenCalledWith("Thandi");
    expect(reader.size).toBe(0);
    expect(await reader.tick()).toBeNull();
  });

  it("reads the chat that has waited longest first, one at a time", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const reader = new ChatReader(
      (title) =>
        new Promise((resolve) => {
          order.push(title);
          release = () => resolve(scheduled);
        }),
      undefined,
      now,
    );
    reader.add("first");
    clock += 1_000;
    reader.add("second");

    const running = reader.tick();
    expect(await reader.tick()).toBeNull();
    release();
    await running;
    expect(order).toEqual(["first"]);
  });

  it("tries again later when asked to, and gives up on old messages", async () => {
    const run = vi.fn(async (): Promise<ReadOutcome> => ({
      kind: "retry",
      afterMs: 60_000,
      reason: "user_active",
    }));
    const reader = new ChatReader(run, undefined, now);
    reader.add("Thandi");

    await reader.tick();
    clock += 30_000;
    expect(await reader.tick()).toBeNull();
    clock += 31_000;
    await reader.tick();
    expect(run).toHaveBeenCalledTimes(2);

    // Still unread half an hour later: left for me
    clock += 30 * 60_000;
    expect(await reader.tick()).toBeNull();
    expect(reader.size).toBe(0);
  });

  it("forgets a chat I reply to myself", async () => {
    const run = vi.fn(async () => scheduled);
    const reader = new ChatReader(run, undefined, now);
    reader.add("Thandi");
    reader.removeChat("Thandi");
    await reader.tick();
    expect(run).not.toHaveBeenCalled();
  });

  it("waits a minute after an unexpected error", async () => {
    const onError = vi.fn();
    const run = vi.fn(async (): Promise<ReadOutcome> => {
      throw new Error("offline");
    });
    const reader = new ChatReader(run, onError, now);
    reader.add("Thandi");

    expect(await reader.tick()).toBeNull();
    expect(onError).toHaveBeenCalled();
    clock += 59_000;
    await reader.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("PageLock", () => {
  it("lets only one automated action use the page at a time", async () => {
    const lock = new PageLock();
    let release: () => void = () => undefined;
    const first = lock.run(() => new Promise<string>((resolve) => (release = () => resolve("sent"))));

    expect(lock.busy).toBe(true);
    await expect(lock.run(async () => "read")).resolves.toBeNull();
    release();
    await expect(first).resolves.toBe("sent");
    expect(lock.busy).toBe(false);
    await expect(lock.run(async () => "read")).resolves.toBe("read");
  });

  it("frees the page when the action fails", async () => {
    const lock = new PageLock();
    await expect(lock.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(lock.busy).toBe(false);
  });
});
