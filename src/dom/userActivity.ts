import { closest } from "../selectors";
import { composer, composerText, currentChatTitle } from "./chat";

/**
 * Watches what I do in WhatsApp Web, using only real (trusted) input, so the
 * extension's own clicks and typing never count.
 * - Automation waits until I've been idle for a while, so it never pulls a
 *   chat out from under me.
 * - When I send a message myself, that chat is mine: automation steps back.
 */
export class UserActivity {
  private lastInputAt = 0;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly doc: Document,
    onManualSend: (chatTitle: string) => void,
  ) {
    const touch = (event: Event) => {
      if (event.isTrusted) this.lastInputAt = Date.now();
    };
    for (const type of ["keydown", "mousedown", "wheel", "touchstart"]) {
      doc.addEventListener(type, touch, { capture: true, passive: true });
      this.cleanup.push(() => doc.removeEventListener(type, touch, { capture: true }));
    }

    // Enter in the message box, or a click on the send button, with text to send
    const reportSend = () => {
      if (!composerText(doc)) return;
      const title = currentChatTitle(doc);
      if (title) onManualSend(title);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.key !== "Enter" || event.shiftKey) return;
      const box = composer(doc);
      if (box && event.target instanceof Node && box.contains(event.target)) reportSend();
    };
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      if (closest("sendButton", event.target)) reportSend();
    };
    doc.addEventListener("keydown", onKeyDown, { capture: true });
    doc.addEventListener("mousedown", onClick, { capture: true });
    this.cleanup.push(
      () => doc.removeEventListener("keydown", onKeyDown, { capture: true }),
      () => doc.removeEventListener("mousedown", onClick, { capture: true }),
    );
  }

  /** No real input for at least this long */
  idleFor(ms: number): boolean {
    return Date.now() - this.lastInputAt >= ms;
  }

  /** Real input happened after this moment */
  activeSince(time: number): boolean {
    return this.lastInputAt > time;
  }

  dispose(): void {
    this.cleanup.forEach((remove) => remove());
  }
}
