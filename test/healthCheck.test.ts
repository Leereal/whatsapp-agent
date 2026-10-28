import { healthKey, LANGUAGE_FAILURE_KEY, runHealthCheck } from "../src/dom/healthCheck";
import { query, resolve, SELECTORS, STRUCTURAL_LABELS } from "../src/selectors";
import { loadFixture } from "./helpers";

const afterStartup = { startupGraceOver: true };
const failedKeys = (doc: Document, options = afterStartup) =>
  runHealthCheck(doc, options).failures.map((failure) => failure.key);

describe("selectors", () => {
  it("find the chat list, rows and titles", () => {
    const doc = loadFixture("synthetic-logged-in.html");
    expect(query("chatList", doc)?.getAttribute("aria-label")).toBe("Chat list");
    expect(resolve("chatRow", doc).elements).toHaveLength(2);
    expect(query("chatRowTitle", doc)?.getAttribute("title")).toBe("Thandi M");
    expect(query("unreadBadge", doc)?.getAttribute("aria-label")).toBe("2 unread messages");
  });

  it("find the open chat's parts, relative to the conversation panel", () => {
    const doc = loadFixture("synthetic-chat-open.html");
    expect(query("conversationTitle", doc)?.getAttribute("title")).toBe("Thandi M");
    expect(resolve("messageRow", doc).elements).toHaveLength(2);
    expect(query("messageMeta", doc)?.getAttribute("data-pre-plain-text")).toContain("10:15");
    expect(query("composer", doc)?.getAttribute("aria-placeholder")).toBe("Type a message");
  });

  it("fall back to later candidates and report which one matched", () => {
    const doc = loadFixture("synthetic-logged-in.html");
    doc.querySelector('[aria-label="Chat list"]')?.removeAttribute("aria-label");

    const chatList = resolve("chatList", doc);
    expect(chatList.elements).toHaveLength(1);
    expect(chatList.candidateIndex).toBeGreaterThan(0);
  });

  it("never rely on class names", () => {
    for (const def of Object.values(SELECTORS)) {
      for (const candidate of def.candidates) expect(candidate).not.toMatch(/\.[a-z_-]/i);
    }
  });

  it("list the aria-labels they depend on", () => {
    expect(STRUCTURAL_LABELS).toEqual(expect.arrayContaining(["Chat list", "Send", "Search"]));
  });
});

describe("runHealthCheck", () => {
  it("recognises the login screen without reporting failures", () => {
    const health = runHealthCheck(loadFixture("synthetic-logged-out.html"), afterStartup);
    expect(health.pageState).toBe("logged_out");
    expect(health.failures).toEqual([]);
  });

  it("passes on the chat list when no chat is open", () => {
    const health = runHealthCheck(loadFixture("synthetic-logged-in.html"), afterStartup);
    expect(health).toMatchObject({ pageState: "ready", chatOpen: false, failures: [] });
  });

  it("also checks the open chat", () => {
    const health = runHealthCheck(loadFixture("synthetic-chat-open.html"), afterStartup);
    expect(health).toMatchObject({ pageState: "ready", chatOpen: true, failures: [] });
  });

  it("treats a missing chat list as loading during startup, then as a failure", () => {
    const doc = loadFixture("synthetic-logged-in.html");
    doc.getElementById("pane-side")?.remove();

    expect(runHealthCheck(doc, { startupGraceOver: false }).pageState).toBe("loading");
    expect(failedKeys(doc)).toEqual(
      expect.arrayContaining(["chatList", "chatRow", "chatRowTitle"]),
    );
  });

  it("reports a missing message box when a chat is open", () => {
    const doc = loadFixture("synthetic-chat-open.html");
    doc.querySelector("footer")?.remove();
    expect(failedKeys(doc)).toEqual(["composer"]);
  });

  it("does not fail on optional or mid-action elements", () => {
    const doc = loadFixture("synthetic-chat-open.html");
    // No unread badge, no text messages, no send button: all normal
    doc.querySelectorAll("[data-pre-plain-text]").forEach((element) => element.remove());
    expect(failedKeys(doc)).toEqual([]);
  });

  it("fails when WhatsApp Web is not in English", () => {
    const doc = loadFixture("synthetic-logged-in.html");
    doc.documentElement.lang = "af";
    expect(failedKeys(doc)).toContain(LANGUAGE_FAILURE_KEY);
  });

  it("gives the same key for the same result, whatever the order", () => {
    const base = { pageState: "ready" as const, chatOpen: true, checkedAt: "" };
    const a = healthKey({
      ...base,
      failures: [
        { key: "composer", candidates_tried: 4 },
        { key: "chatRow", candidates_tried: 2 },
      ],
    });
    const b = healthKey({
      ...base,
      failures: [
        { key: "chatRow", candidates_tried: 2 },
        { key: "composer", candidates_tried: 4 },
      ],
    });
    expect(a).toBe(b);
  });
});
