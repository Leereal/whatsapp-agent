/**
 * Low-level page interactions. WhatsApp Web is a React app with a Lexical
 * editor, so plain property changes are ignored; these dispatch the events
 * it listens for.
 */

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll until the check returns something truthy, or give up (null) */
export async function waitFor<T>(
  check: () => T | null | undefined | false,
  timeoutMs: number,
  intervalMs = 200,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

/**
 * The sequence of events a real click produces, at the element's centre.
 * Handlers only see events from the element they sit on or its children, so
 * click the innermost element a person would (e.g. a chat's name), not a
 * wrapper around it.
 */
export function clickLikeUser(element: Element): void {
  const box = element.getBoundingClientRect();
  const mouse = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    detail: 1,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  };
  const pointer = { ...mouse, pointerId: 1, pointerType: "mouse", isPrimary: true };
  element.dispatchEvent(new PointerEvent("pointerover", pointer));
  element.dispatchEvent(new MouseEvent("mouseover", mouse));
  element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
  element.dispatchEvent(new MouseEvent("mousedown", { ...mouse, buttons: 1 }));
  element.dispatchEvent(new PointerEvent("pointerup", pointer));
  element.dispatchEvent(new MouseEvent("mouseup", mouse));
  element.dispatchEvent(new MouseEvent("click", mouse));
}

export function elementText(element: Element | null): string {
  return (element?.textContent ?? "").replace(/‎|‏/g, "").trim();
}

/**
 * Put text into an editable element. Pasting keeps line breaks and is what
 * the Lexical editor handles most reliably; plain inputs get their value set
 * through the native setter so React sees the change.
 */
export function insertText(element: HTMLElement, text: string): void {
  element.focus();

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = Object.getPrototypeOf(element) as object;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  const data = new DataTransfer();
  data.setData("text/plain", text);
  element.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
  );
}

/** Empty an editable element (used to undo our own text, never the user's) */
export function clearText(element: HTMLElement): void {
  element.focus();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    insertText(element, "");
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.execCommand("delete");
}

export function pressKey(element: HTMLElement, key: string): void {
  for (const type of ["keydown", "keyup"] as const) {
    element.dispatchEvent(
      new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }),
    );
  }
}
