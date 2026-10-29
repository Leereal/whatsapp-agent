import { insertDraft, readOpenChat } from "../src/copilot";
import { parseMessageTime, readChatMessages } from "../src/dom/chat";
import { loadFixture } from "./helpers";

const local = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

describe("parseMessageTime", () => {
  it("reads day-first dates (South Africa)", () => {
    expect(parseMessageTime("[14:05, 28/10/2026] Thandi M: ")).toBe(local(2026, 10, 28, 14, 5));
    expect(parseMessageTime("[09:30, 03/11/2026] Me: ")).toBe(local(2026, 11, 3, 9, 30));
  });

  it("reads month-first, year-first and 12-hour formats", () => {
    expect(parseMessageTime("[2:05 pm, 10/28/2026] X: ")).toBe(local(2026, 10, 28, 14, 5));
    expect(parseMessageTime("[12:10 AM, 10/28/26] X: ")).toBe(local(2026, 10, 28, 0, 10));
    expect(parseMessageTime("[08:00, 2026/10/28] X: ")).toBe(local(2026, 10, 28, 8, 0));
  });

  it("gives null for anything it can't read", () => {
    expect(parseMessageTime(null)).toBeNull();
    expect(parseMessageTime("[00:00, 00/00/0000] Contact: ")).toBeNull();
    expect(parseMessageTime("yesterday")).toBeNull();
  });
});

/** An open chat with a header, two messages and an empty message box */
function chatPage(title = "+27 60 000 1234") {
  const doc = new DOMParser().parseFromString(
    `<div id="main">
       <header><span dir="auto" title="${title}">${title}</span></header>
       <div role="application">
         <div role="row"><div data-id="3EB0IN1">
           <span aria-label="+27 60 000 1234:"></span>
           <div data-pre-plain-text="[14:05, 28/10/2026] +27 60 000 1234: "><div>
             <span data-testid="selectable-text">How much is a CV <img data-plain-text="🤔" alt="🤔"></span>
           </div></div>
         </div></div>
         <div role="row"><div data-id="3EB0PHOTO">
           <span data-icon="tail-in"></span><img src="blob:https://web.whatsapp.com/1">
         </div></div>
         <div role="row"><div data-id="3EB0NOSIGN"><div><span data-testid="selectable-text">?</span></div></div></div>
       </div>
       <footer><div contenteditable="true" role="textbox"></div></footer>
     </div>`,
    "text/html",
  );
  const box = doc.querySelector<HTMLElement>('[role="textbox"]')!;
  // Stands in for WhatsApp's editor, which takes pasted text
  box.addEventListener("paste", (event) => {
    box.textContent = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
  });
  return { doc, box };
}

describe("reading the open chat for a draft", () => {
  it("reads text with emoji, photos and times, and skips messages it can't attribute", () => {
    const { doc } = chatPage();
    expect(readChatMessages(doc)).toEqual([
      {
        wa_message_id: "3EB0IN1",
        direction: "in",
        text: "How much is a CV 🤔",
        media_type: "none",
        sent_at: local(2026, 10, 28, 14, 5),
      },
      { wa_message_id: "3EB0PHOTO", direction: "in", text: "", media_type: "image", sent_at: null },
    ]);
  });

  it("reads the real snapshot: the ad greeting, their message and my pricing", () => {
    const messages = readChatMessages(loadFixture("real-chat-open.html"));
    expect(messages.map((message) => message.direction)).toEqual(["out", "in", "out"]);
    expect(messages.every((message) => message.text.length > 0)).toBe(true);
    // Emoji drawn as images come back as characters
    expect(messages[2]?.text).toContain("👋");
  });

  it("names the chat and its number", () => {
    const { doc } = chatPage();
    expect(readOpenChat(doc)).toMatchObject({ title: "+27 60 000 1234", phone: "+27600001234" });
    expect(readOpenChat(new DOMParser().parseFromString("<div></div>", "text/html"))).toEqual({
      error: "Open the client's chat in WhatsApp first.",
    });
  });
});

describe("insertDraft", () => {
  it("puts the draft in the message box without sending", async () => {
    const { doc, box } = chatPage();
    await expect(
      insertDraft(doc, { title: "+27600001234", text: "Hi! Here are our prices 👇", send: false }),
    ).resolves.toEqual({ ok: true, sent: false });
    expect(box.textContent).toBe("Hi! Here are our prices 👇");
  });

  it("never writes into another chat", async () => {
    const { doc, box } = chatPage("+27 82 000 0000");
    const result = await insertDraft(doc, { title: "+27 60 000 1234", text: "Hi", send: false });
    expect(result).toMatchObject({ ok: false });
    expect(box.textContent).toBe("");
  });

  it("never touches a message I'm typing", async () => {
    const { doc, box } = chatPage();
    box.textContent = "Half-written reply";
    const result = await insertDraft(doc, { title: "+27 60 000 1234", text: "Hi", send: false });
    expect(result).toEqual({
      ok: false,
      error: "You have a message typed in this chat. Send or clear it first.",
    });
    expect(box.textContent).toBe("Half-written reply");
  });
});
