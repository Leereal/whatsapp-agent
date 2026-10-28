import {
  maskDataId,
  maskPrePlainText,
  maskText,
  scrubLabel,
  takeSnapshot,
} from "../src/dom/snapshot";
import { loadFixture } from "./helpers";

describe("snapshot scrubbing", () => {
  it("masks text but keeps its shape", () => {
    expect(maskText("Hi Thandi, R120 ok?")).toBe("xx xxxxxx, x000 xx?");
  });

  it("masks phone numbers and message ids in data-id", () => {
    expect(maskDataId("false_27821234567@c.us_3EB0C9F1A2")).toBe(
      "false_00000000000@c.us_XXXXXXXXXX",
    );
    expect(maskDataId("123456789012@lid")).toBe("000000000000@lid");
  });

  it("keeps WhatsApp's own labels but not names inside other labels", () => {
    expect(scrubLabel("Chat list")).toBe("Chat list");
    expect(scrubLabel("Type a message")).toBe("Type a message");
    expect(scrubLabel("2 unread messages")).toBe("0 unread messagex");
    expect(scrubLabel("Send a message to Thandi")).not.toContain("Thandi");
  });

  it("masks the author and time of a message", () => {
    expect(maskPrePlainText("[10:15, 28/10/2026] Thandi M: ")).toBe(
      "[00:00, 00/00/0000] Contact: ",
    );
  });

  it("removes every client detail from a page", () => {
    const html = takeSnapshot(loadFixture("synthetic-chat-open.html"));

    for (const secret of ["Thandi", "4567", "27821234567", "how much", "blob:", "CV photo"]) {
      expect(html).not.toContain(secret);
    }
  });

  it("keeps what the selectors need", () => {
    const html = takeSnapshot(loadFixture("synthetic-chat-open.html"));

    expect(html).toContain('aria-label="Chat list"');
    expect(html).toContain('aria-placeholder="Type a message"');
    expect(html).toContain('role="row"');
    expect(html).toContain('id="main"');
    expect(html).toContain("@c.us");

    // The result is itself a usable fixture
    const reparsed = new DOMParser().parseFromString(html, "text/html");
    expect(reparsed.querySelector('[aria-label="Chat list"] [role="row"]')).not.toBeNull();
  });
});
