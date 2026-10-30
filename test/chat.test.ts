import {
  adSource,
  assessChat,
  assessReplyChat,
  comparable,
  currentChatTitle,
  expandLongMessages,
  findOurMessage,
  isChatOpen,
  messagesAfter,
  openChat,
  openFailureDetails,
  readChatMessages,
  readMessages,
  sameTitle,
  sendFailureDetails,
  snippet,
  waitForSent,
  type ChatMessage,
} from "../src/dom/chat";
import { loadFixture } from "./helpers";

const NUMBER = "+27 60 000 1234";
// How WhatsApp may draw the same number: direction marks and no-break spaces
const DRAWN_NUMBER = "‪+27 60 000 1234‬";

/** A chat list whose row only opens on a mousedown inside the row's inner cell, like React handlers */
function pageWithChat(): Document {
  const doc = new DOMParser().parseFromString(
    `<div id="side"><div id="pane-side"><div aria-label="Chat list" role="grid">
       <div role="listitem"><div role="row" tabindex="-1"><div>
         <div id="cell" role="gridcell"><div><span dir="auto" title="${NUMBER}">${NUMBER}</span></div></div>
       </div></div></div>
     </div></div></div>
     <div id="main"></div>`,
    "text/html",
  );
  doc.getElementById("cell")?.addEventListener("mousedown", () => {
    const main = doc.getElementById("main");
    if (main) main.innerHTML = `<header><div><span dir="auto">${DRAWN_NUMBER}</span></div></header>`;
  });
  return doc;
}

describe("matching chat titles", () => {
  it("treats differently drawn copies of a number as the same chat", () => {
    expect(sameTitle(NUMBER, DRAWN_NUMBER)).toBe(true);
    expect(sameTitle(NUMBER, "+27600001234")).toBe(true);
    expect(sameTitle(NUMBER, "+27 60 000 1235")).toBe(false);
  });

  it("compares names without case or extra spaces", () => {
    expect(sameTitle("Thandi  M", "thandi m")).toBe(true);
    expect(sameTitle("Thandi M", "Thandi")).toBe(false);
  });

  it("finds the title anywhere in the open chat's header", () => {
    expect(isChatOpen(loadFixture("synthetic-chat-open.html"), "Thandi M")).toBe(true);
    expect(isChatOpen(loadFixture("synthetic-chat-open.html"), "Sipho")).toBe(false);
  });
});

describe("openChat", () => {
  afterEach(() => vi.useRealTimers());

  it("clicks the chat's name, so handlers inside the row see it", async () => {
    const doc = pageWithChat();
    await expect(openChat(doc, NUMBER, null)).resolves.toBe("opened");
    expect(isChatOpen(doc, NUMBER)).toBe(true);
  });

  it("says the chat didn't open when clicking changes nothing", async () => {
    vi.useFakeTimers();
    const doc = pageWithChat();
    // Same row, but nothing inside it reacts
    const cell = doc.getElementById("cell");
    cell?.replaceWith(cell.cloneNode(true));

    const result = openChat(doc, NUMBER, null);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("did_not_open");
  });

  it("says when the chat isn't in the list", async () => {
    await expect(openChat(pageWithChat(), "+27 82 000 0000", null)).resolves.toBe(
      "row_not_found",
    );
  });

  it("describes the page around a failed chat without names or numbers", () => {
    const details = openFailureDetails(pageWithChat(), NUMBER);
    expect(details).toMatchObject({ row_found: true, header_found: false });
    expect(details.row_to_name).toBe(
      "div[role=row][tabindex=-1] > div > div[role=gridcell] > div > span[title]",
    );
    expect(JSON.stringify(details)).not.toMatch(/1234/);
  });
});

const incoming = (text: string, n = 1): ChatMessage => ({
  id: `false_27710005678@c.us_IN${n}`,
  outgoing: false,
  text,
});
const outgoing = (text: string, n = 1): ChatMessage => ({
  id: `true_27710005678@c.us_OUT${n}`,
  outgoing: true,
  text,
});

describe("reading the open chat", () => {
  const doc = loadFixture("synthetic-chat-open.html");

  it("reads the chat title from the header", () => {
    expect(currentChatTitle(doc)).toBe("Thandi M");
  });

  it("reads messages and their direction from data-id", () => {
    const messages = readMessages(doc);
    expect(messages.map((message) => message.outgoing)).toEqual([false, true]);
    expect(messages[0]?.id).toBe("false_27821234567@c.us_3EB0C9F1A2");
  });
});

describe("reading runs of messages", () => {
  /** Their text (with a tail), a notice, then two more of theirs with no sign of their own */
  function chatWithRun(): Document {
    return new DOMParser().parseFromString(
      `<div id="main"><header><span dir="auto" title="Thandi M">Thandi M</span></header>
         <div role="row"><div data-id="FIRST">
           <span data-icon="tail-in"></span>
           <div data-pre-plain-text="[15:35, 30/10/2026] Thandi M: "><span data-testid="selectable-text">PERSONAL INFORMATION Thandi M, Cape Town…</span><div role="button" id="more">Read more</div></div>
         </div></div>
         <div role="row"><div data-id="NOTICE"><div data-testid="system_message">Messages are end-to-end encrypted</div></div></div>
         <div role="row"><div data-id="SECOND">
           <div data-pre-plain-text="[15:36, 30/10/2026] Thandi M: "><span data-testid="selectable-text">Please add my diploma</span></div>
         </div></div>
         <div role="row"><div data-id="THIRD"><img src="blob:https://web.whatsapp.com/photo" alt=""></div></div>
       </div>`,
      "text/html",
    );
  }

  it("gives a message with no sign of its own the sender of the message before it", () => {
    expect(readMessages(chatWithRun()).map((message) => [message.id, message.outgoing])).toEqual([
      ["FIRST", false],
      ["SECOND", false],
      ["THIRD", false],
    ]);
  });

  it("doesn't read the Read more link as part of the message", () => {
    expect(readChatMessages(chatWithRun())[0]?.text).toBe(
      "PERSONAL INFORMATION Thandi M, Cape Town…",
    );
  });

  it("opens long messages so their whole text is read", async () => {
    const doc = chatWithRun();
    const more = doc.getElementById("more")!;
    more.addEventListener("click", () => {
      more.previousElementSibling!.textContent =
        "PERSONAL INFORMATION Thandi M, Cape Town. Date of birth 09/02/89. Nationality: Zimbabwean";
      more.remove();
    });
    expect(await expandLongMessages(doc)).toBe(1);
    expect(readChatMessages(doc)[0]?.text).toContain("Nationality: Zimbabwean");
  });

  it("opens nothing when no message is cut off", async () => {
    const doc = chatWithRun();
    doc.getElementById("more")!.remove();
    expect(await expandLongMessages(doc)).toBe(0);
  });
});

describe("reading a real chat (scrubbed snapshot, Oct 2026)", () => {
  // An ad lead: Meta's notices, the ad greeting (mine), their "Hello",
  // then the pricing message (mine). Text is masked; ids carry no direction.
  const doc = loadFixture("real-chat-open.html");
  const messages = readMessages(doc);

  it("skips WhatsApp's notices and tells mine from theirs without the old id format", () => {
    expect(messages.map((message) => message.outgoing)).toEqual([true, false, true]);
    expect(messages.every((message) => !/^(true|false)_/.test(message.id))).toBe(true);
  });

  it("sees that I've already written to them", () => {
    expect(assessChat(messages)).toEqual({ isNew: false, reason: "last_message_is_mine" });
  });

  it("recognises the open chat from its header", () => {
    expect(isChatOpen(doc, "+00 00 000 0000")).toBe(true);
  });

  it("refuses to guess when a message has no sign of who sent it", () => {
    const unknown = { id: "3EB0X", outgoing: null, text: "Hello" };
    expect(assessChat([unknown])).toEqual({ isNew: false, reason: "direction_unknown" });
  });

  it("refuses to guess when the signs disagree", () => {
    const copy = loadFixture("real-chat-open.html");
    const mine = copy.querySelectorAll('[data-icon="tail-out"]')[0];
    mine?.setAttribute("data-icon", "tail-in");
    expect(readMessages(copy)[0]?.outgoing).toBeNull();
  });
});

describe("assessChat", () => {
  it("accepts a chat that only has their messages", () => {
    expect(assessChat([incoming("Hello! Can I get more info on this?")])).toEqual({
      isNew: true,
      source: null,
    });
  });

  it("ignores Meta's automated ad greeting and notes the ad", () => {
    const greeting = outgoing(
      "Facebook ad View details Hi! Please let us know how we can help you. Automated greeting",
    );
    expect(assessChat([greeting, incoming("Hello")])).toEqual({ isNew: true, source: "fb_ad" });
    expect(adSource([outgoing("Instagram ad · Automated greeting")])).toBe("ig_ad");
  });

  it("rejects chats where I've already written", () => {
    expect(assessChat([outgoing("Hi there! Get your CV…"), incoming("Ok")])).toEqual({
      isNew: false,
      reason: "existing_chat",
    });
  });

  it("rejects chats whose last message is mine", () => {
    expect(assessChat([incoming("Hello"), outgoing("Hi!")])).toEqual({
      isNew: false,
      reason: "last_message_is_mine",
    });
  });

  it("skips an existing chat even when some older messages can't be read", () => {
    const unknown = { id: "3EB0OLD", outgoing: null, text: "Old message" };
    expect(assessChat([unknown, outgoing("Hi! Your CV is ready"), incoming("Thanks")])).toEqual({
      isNew: false,
      reason: "existing_chat",
    });
  });

  it("fails safe when no messages can be read", () => {
    expect(assessChat([])).toEqual({ isNew: false, reason: "no_messages_found" });
  });
});

describe("assessReplyChat", () => {
  const question = incoming("Do you also do cover letters?", 2);

  it("lets a reply go while the message it answers is still the last one", () => {
    const chat = [outgoing("Hi there! Get your CV…"), question];
    expect(assessReplyChat(chat, question.id)).toEqual({ ok: true });
  });

  it("holds back once the chat has moved on", () => {
    const later = incoming("Hello??", 3);
    expect(assessReplyChat([question, later], question.id)).toEqual({
      ok: false,
      reason: "chat_moved_on",
    });
    expect(assessReplyChat([question, outgoing("Yes we do!")], question.id)).toEqual({
      ok: false,
      reason: "already_answered",
    });
  });

  it("fails safe when it can't tell who wrote last", () => {
    const unknown = { id: "3EB0X", outgoing: null, text: "Hello" };
    expect(assessReplyChat([question, unknown], question.id)).toEqual({
      ok: false,
      reason: "direction_unknown",
    });
    expect(assessReplyChat([], question.id)).toEqual({ ok: false, reason: "no_messages_found" });
  });

  it("looks for an earlier copy of a reply only after the message it answers", () => {
    const before = outgoing("Please send your old CV", 1);
    const after = outgoing("Please send your old CV", 2);
    expect(messagesAfter([before, question, after], question.id)).toEqual([after]);
    expect(messagesAfter([before, question], question.id)).toEqual([]);
    // Not on screen any more: nothing counts as an earlier copy
    expect(messagesAfter([before, after], question.id)).toEqual([]);
  });
});

describe("confirming a send", () => {
  const body = "👋 *Hi there! Get your CV in less than 2 hours*";

  /** An open chat with one message from them; `add` appends a bubble */
  function chat() {
    const doc = new DOMParser().parseFromString(
      `<div id="main"><div role="application">
         <div role="row"><div data-id="false_27600001234@c.us_IN1">Hello! Can I get more info on this?</div></div>
       </div><footer><div contenteditable="true" role="textbox"></div></footer></div>`,
      "text/html",
    );
    const add = (id: string, text: string) =>
      doc
        .querySelector('[role="application"]')
        ?.insertAdjacentHTML("beforeend", `<div role="row"><div data-id="${id}">${text}</div></div>`);
    return { doc, add, before: new Set(readMessages(doc).map((message) => message.id)) };
  }

  it("confirms a new bubble by its words, whatever its id says about direction", async () => {
    const { doc, add, before } = chat();
    add("3EB0NEWFORMAT", "Hi there! Get your CV in less than 2 hours");
    await expect(waitForSent(doc, before, body)).resolves.toMatchObject({ id: "3EB0NEWFORMAT" });
  });

  it("finds a message an earlier attempt already sent", () => {
    const { doc, add } = chat();
    add("true_27600001234@c.us_OUT1", "Hi there! Get your CV in less than 2 hours");
    expect(findOurMessage(readMessages(doc), body)?.id).toBe("true_27600001234@c.us_OUT1");
  });

  it("reports what it saw without names, numbers or text", () => {
    const { doc, add, before } = chat();
    add("true_27600001234@c.us_OUT1", "Something else");
    const details = sendFailureDetails(doc, before, body);
    expect(details).toMatchObject({ new_messages: 1, new_outgoing: 1, our_text_found: false });
    expect(details.last_ids).toBe("false_0@c.us_X, true_0@c.us_X");
    expect(JSON.stringify(details)).not.toMatch(/1234|Hello|Something/);
  });
});

describe("recognising our message on screen", () => {
  const pricing = "👋 *Hi there! Get your CV in less than 2 hours*\n\nCV + Cover Letter – R120";

  it("ignores emoji (drawn as images) and bold markers", () => {
    expect(snippet(pricing)).toBe("hi there get your cv in less t");
    const bubble = "Hi there! Get your CV in less than 2 hoursCV + Cover Letter– R12022:32";
    expect(comparable(bubble)).toContain(snippet(pricing));
  });
});
