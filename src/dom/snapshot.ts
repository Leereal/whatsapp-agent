import { STRUCTURAL_LABELS } from "../selectors";

/**
 * Saves the structure of WhatsApp Web as HTML for test fixtures, with client
 * data removed: text is masked, phone numbers and message ids are zeroed,
 * images and links are dropped. aria-labels the selectors rely on stay
 * readable; any other label is masked because it can contain a contact name.
 *
 * Review a snapshot before committing it under test/fixtures.
 */

const REMOVE_ELEMENTS = "script, style, link, noscript, iframe, meta, template, video, audio";
// value can hold whatever was typed into the search or message box
const DROP_ATTRIBUTES = new Set(["src", "srcset", "href", "style", "poster", "data-src", "value"]);
const LABEL_ATTRIBUTES = new Set([
  "aria-label",
  "aria-placeholder",
  "aria-description",
  "title",
  "alt",
  "placeholder",
]);

/**
 * WhatsApp's own interface labels, kept verbatim when a label is exactly one
 * of these. Anything else may contain a contact name.
 */
const UI_LABELS = new Set([
  ...STRUCTURAL_LABELS,
  "Chat list",
  "Search input textbox",
  "Search or start a new chat",
  "Type a message",
  "Send",
  "Attach",
  "Menu",
  "New chat",
  "Emoji",
  "Voice message",
]);

const maskChar = (char: string) => (/\p{L}/u.test(char) ? "x" : /\p{N}/u.test(char) ? "0" : char);

/** Letters → x, digits → 0; spacing and punctuation keep the layout recognisable */
export function maskText(text: string): string {
  return text.replace(/\p{L}/gu, "x").replace(/\p{N}/gu, "0");
}

/**
 * A known UI label stays as it is. Otherwise only the fragments the selectors
 * match on survive ("2 unread messages" → "0 unread messagex"); the rest is masked.
 */
export function scrubLabel(value: string): string {
  if (UI_LABELS.has(value)) return value;

  const keep = new Array<boolean>(value.length).fill(false);
  for (const fragment of STRUCTURAL_LABELS) {
    for (
      let index = value.indexOf(fragment);
      index !== -1;
      index = value.indexOf(fragment, index + 1)
    ) {
      keep.fill(true, index, index + fragment.length);
    }
  }
  // split("") walks UTF-16 units, matching indexOf's positions
  return value
    .split("")
    .map((char, index) => (keep[index] ? char : maskChar(char)))
    .join("");
}

/** "false_27821234567@c.us_3EB0C9F1" → "false_00000000000@c.us_XXXXXXXX" */
export function maskDataId(value: string): string {
  const parts = value.split("_");
  return parts
    .map((part, index) => {
      if (index === 0 && (part === "true" || part === "false")) return part;
      const [user, domain] = part.split("@");
      if (domain) return `${(user ?? "").replace(/\d/g, "0")}@${domain}`;
      return part.replace(/[A-Za-z0-9]/g, "X");
    })
    .join("_");
}

/** "[10:15, 28/10/2026] Thandi M: " → "[00:00, 00/00/0000] Contact: " */
export function maskPrePlainText(value: string): string {
  return value.replace(/\d/g, "0").replace(/\]\s*[^\]]*:\s*$/, "] Contact: ");
}

function scrubElement(element: Element): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (DROP_ATTRIBUTES.has(name)) {
      element.removeAttribute(attribute.name);
    } else if (name === "data-id") {
      element.setAttribute(attribute.name, maskDataId(attribute.value));
    } else if (name === "data-pre-plain-text") {
      element.setAttribute(attribute.name, maskPrePlainText(attribute.value));
    } else if (LABEL_ATTRIBUTES.has(name)) {
      element.setAttribute(attribute.name, scrubLabel(attribute.value));
    }
  }
  // Icons are identified by data-icon; their drawing paths are just noise
  if (element.tagName.toLowerCase() === "svg") element.replaceChildren();
}

export function takeSnapshot(doc: Document): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll(REMOVE_ELEMENTS).forEach((element) => element.remove());

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  scrubElement(root);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) textNodes.push(node as Text);
    else scrubElement(node as Element);
  }
  for (const text of textNodes) text.data = maskText(text.data);

  const stamp = new Date().toISOString();
  return `<!doctype html>\n<!-- Scrubbed WhatsApp Web snapshot, ${stamp}. Review before committing. -->\n${root.outerHTML}`;
}
