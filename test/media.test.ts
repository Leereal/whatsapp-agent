import { bytesToBase64 } from "../src/bytes";
import {
  captureDocument,
  filenameFromTitle,
  listMediaMessages,
  messageIds,
  pasteFile,
  waitForSentPhoto,
} from "../src/dom/media";
import { readChatMessages } from "../src/dom/chat";

const TITLE = "Thandi M";
const JPEG = {
  base64: bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff])),
  mime: "image/jpeg",
  filename: "CV preview v2.jpg",
};

/** An open chat: their photo, their document, my photo, and a text from them */
function chatPage(): Document {
  return new DOMParser().parseFromString(
    `<div id="main">
       <header><span dir="auto" title="${TITLE}">${TITLE}</span></header>
       <div role="application">
         <div role="row"><div data-id="IN_PHOTO">
           <span data-icon="tail-in"></span>
           <img src="blob:https://web.whatsapp.com/photo-1" alt="">
         </div></div>
         <div role="row"><div data-id="IN_DOC">
           <span data-icon="tail-in"></span>
           <div role="button" title='Download "Thandi CV 2026.pdf"'><span>Thandi CV 2026.pdf</span></div>
           <div class="copyable-text" data-pre-plain-text="[10:15, 28/10/2026] Thandi M: "></div>
         </div></div>
         <div role="row"><div data-id="OUT_PHOTO">
           <span data-icon="tail-out"></span>
           <img src="blob:https://web.whatsapp.com/photo-2" alt="">
         </div></div>
         <div role="row"><div data-id="IN_TEXT">
           <span data-icon="tail-in"></span>
           <div data-pre-plain-text="[10:16, 28/10/2026] Thandi M: "><span data-testid="selectable-text">Here it is</span></div>
         </div></div>
       </div>
       <footer><div contenteditable="true" role="textbox" aria-placeholder="Type a message"></div></footer>
     </div>`,
    "text/html",
  );
}

/** WhatsApp's photo editor: it opens with a caption box when a file is pasted or attached */
function openEditorOn(doc: Document, files: () => FileList | File[] | null | undefined) {
  const editor = doc.createElement("div");
  editor.innerHTML = `<div contenteditable="true" role="textbox" aria-placeholder="Add a caption"></div>`;
  return () => {
    const list = files();
    if (list && Array.from(list).length > 0 && !editor.isConnected) doc.body.appendChild(editor);
  };
}

describe("filenameFromTitle", () => {
  it("reads the document's name from its download control", () => {
    expect(filenameFromTitle('Download "Thandi CV 2026.pdf"')).toBe("Thandi CV 2026.pdf");
    expect(filenameFromTitle("Download “CV.docx”")).toBe("CV.docx");
    expect(filenameFromTitle("Open")).toBeNull();
    expect(filenameFromTitle(null)).toBeNull();
  });
});

describe("listMediaMessages", () => {
  it("lists the client's photos and documents, not mine or plain text", () => {
    expect(listMediaMessages(chatPage())).toEqual([
      { wa_message_id: "IN_PHOTO", kind: "image", filename: null, sent_at: null },
      {
        wa_message_id: "IN_DOC",
        kind: "document",
        filename: "Thandi CV 2026.pdf",
        sent_at: new Date(2026, 9, 28, 10, 15).toISOString(),
      },
    ]);
  });

  it("marks documents in the messages it reads", () => {
    const types = Object.fromEntries(
      readChatMessages(chatPage()).map((message) => [message.wa_message_id, message.media_type]),
    );
    expect(types).toMatchObject({ IN_PHOTO: "image", IN_DOC: "document", IN_TEXT: "none" });
  });

  it("lists a photo they sent after another of their messages, which has no tail of its own", () => {
    // WhatsApp only marks the first bubble of a run; the photo and document follow their text
    const doc = new DOMParser().parseFromString(
      `<div id="main">
         <header><span dir="auto" title="${TITLE}">${TITLE}</span></header>
         <div role="row"><div data-id="IN_FIRST">
           <span data-icon="tail-in"></span>
           <div data-pre-plain-text="[15:33, 30/10/2026] Thandi M: "><span data-testid="selectable-text">My CV</span></div>
         </div></div>
         <div role="row"><div data-id="IN_CV_PHOTO"><img src="blob:https://web.whatsapp.com/cv" alt=""></div></div>
         <div role="row"><div data-id="IN_HEADSHOT"><img src="blob:https://web.whatsapp.com/me" alt=""></div></div>
         <div role="row"><div data-id="OUT_REPLY">
           <span data-icon="tail-out"></span>
           <div data-pre-plain-text="[15:40, 30/10/2026] Me: "><span data-testid="selectable-text">Thanks</span></div>
         </div></div>
         <div role="row"><div data-id="OUT_PHOTO"><img src="blob:https://web.whatsapp.com/mine" alt=""></div></div>
       </div>`,
      "text/html",
    );
    expect(listMediaMessages(doc).map((item) => item.wa_message_id)).toEqual([
      "IN_CV_PHOTO",
      "IN_HEADSHOT",
    ]);
    expect(
      readChatMessages(doc).map((message) => [message.wa_message_id, message.direction]),
    ).toEqual([
      ["IN_FIRST", "in"],
      ["IN_CV_PHOTO", "in"],
      ["IN_HEADSHOT", "in"],
      ["OUT_REPLY", "out"],
      ["OUT_PHOTO", "out"],
    ]);
  });

  it("still leaves out a photo at the top of the chat with no sign of who sent it", () => {
    const doc = new DOMParser().parseFromString(
      `<div id="main"><header><span dir="auto" title="${TITLE}">${TITLE}</span></header>
         <div role="row"><div data-id="UNKNOWN"><img src="blob:https://web.whatsapp.com/x" alt=""></div></div>
       </div>`,
      "text/html",
    );
    expect(listMediaMessages(doc)).toEqual([]);
  });
});

describe("captureDocument", () => {
  it("clicks the download control and reads the file WhatsApp saved", async () => {
    const doc = chatPage();
    const clicked = vi.fn();
    doc.querySelector('[title^="Download"]')?.addEventListener("click", clicked);
    const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(pdf));
    const waitForDownload = vi.fn(async () => ({
      url: "blob:https://web.whatsapp.com/doc",
      filename: "x.pdf",
    }));

    const result = await captureDocument(doc, "IN_DOC", waitForDownload);

    expect(clicked).toHaveBeenCalled();
    expect(waitForDownload).toHaveBeenCalledWith(expect.any(Number));
    expect(result).toEqual({
      ok: true,
      file: { base64: btoa("%PDF-1.7"), mime: "application/pdf", filename: "Thandi CV 2026.pdf" },
    });
  });

  it("gives up cleanly when WhatsApp doesn't download it", async () => {
    const result = await captureDocument(chatPage(), "IN_DOC", async () => null);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Upload") });
  });
});

describe("pasteFile", () => {
  it("pastes the file into the message box and fills in the caption", async () => {
    const doc = chatPage();
    const box = doc.querySelector<HTMLElement>("footer [contenteditable]")!;
    let pasted: File[] = [];
    box.addEventListener("paste", (event) => {
      pasted = Array.from((event as ClipboardEvent).clipboardData?.files ?? []);
      openEditorOn(doc, () => pasted)();
    });

    const result = await pasteFile(doc, {
      title: TITLE,
      file: JPEG,
      caption: "Here's your CV preview",
    });

    expect(pasted).toHaveLength(1);
    expect(pasted[0]).toMatchObject({ name: "CV preview v2.jpg", type: "image/jpeg" });
    expect(result.ok).toBe(true);
  });

  it("falls back to the attach menu when pasting does nothing", async () => {
    const doc = chatPage();
    const footer = doc.querySelector("footer")!;
    footer.insertAdjacentHTML("afterbegin", `<button aria-label="Attach"></button>`);
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/mp4";
    doc
      .querySelector('[aria-label="Attach"]')
      ?.addEventListener("click", () => doc.body.appendChild(input));
    input.addEventListener(
      "change",
      openEditorOn(doc, () => input.files),
    );

    const result = await pasteFile(doc, { title: TITLE, file: JPEG, caption: "" });

    expect(input.files?.[0]?.name).toBe("CV preview v2.jpg");
    expect(result).toEqual({ ok: true, captioned: true });
  }, 15_000);

  it("never pastes into another chat, or over a message I'm typing", async () => {
    const doc = chatPage();
    expect(await pasteFile(doc, { title: "Someone else", file: JPEG, caption: "" })).toMatchObject({
      ok: false,
    });
    doc.querySelector("footer [contenteditable]")!.textContent = "half a reply";
    expect(await pasteFile(doc, { title: TITLE, file: JPEG, caption: "" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("typed"),
    });
  });
});

describe("waitForSentPhoto", () => {
  it("finds the photo I sent after the paste", async () => {
    const doc = chatPage();
    const before = messageIds(doc);
    setTimeout(() => {
      doc
        .querySelector('[role="application"]')!
        .insertAdjacentHTML(
          "beforeend",
          `<div role="row"><div data-id="NEW_OUT"><span data-icon="tail-out"></span><img src="blob:https://web.whatsapp.com/sent"></div></div>`,
        );
    }, 50);
    expect(await waitForSentPhoto(doc, TITLE, before, 3_000)).toBe("NEW_OUT");
  });

  it("finds it when it follows a message of mine, so it has no tail", async () => {
    const doc = chatPage();
    doc
      .querySelector('[role="application"]')!
      .insertAdjacentHTML(
        "beforeend",
        `<div role="row"><div data-id="MY_TEXT"><span data-icon="tail-out"></span><div data-pre-plain-text="[17:15, 30/10/2026] Me: "><span data-testid="selectable-text">Here is your preview</span></div></div></div>`,
      );
    const before = messageIds(doc);
    setTimeout(() => {
      doc
        .querySelector('[role="application"]')!
        .insertAdjacentHTML(
          "beforeend",
          `<div role="row"><div data-id="NEW_OUT"><img src="blob:https://web.whatsapp.com/sent"></div></div>`,
        );
    }, 50);
    expect(await waitForSentPhoto(doc, TITLE, before, 3_000)).toBe("NEW_OUT");
  });

  it("returns null when I didn't send it in time", async () => {
    const doc = chatPage();
    expect(await waitForSentPhoto(doc, TITLE, messageIds(doc), 50)).toBeNull();
  });
});
