/**
 * Structure-only descriptions of page elements for error reports: tag names
 * and structural attributes. Never text, titles or labels, which can hold a
 * client's name or number.
 */

const KEEP_ATTRIBUTES = ["role", "tabindex", "aria-selected", "data-testid", "data-icon", "data-tab"];
const INTERACTIVE = '[tabindex], [role="button"], [role="gridcell"], [role="link"], button, a';
const MAX_INTERACTIVE = 8;

/** 'div[role=row][tabindex=-1]', plus '[title]' when it has one (value left out) */
export function describeElement(element: Element): string {
  const attributes = KEEP_ATTRIBUTES.flatMap((name) => {
    const value = element.getAttribute(name);
    // Long digit runs could be an id built from a phone number
    return value === null ? [] : [`[${name}=${value.replace(/\d{5,}/g, "0")}]`];
  });
  const title = element.hasAttribute("title") ? "[title]" : "";
  return `${element.tagName.toLowerCase()}${attributes.join("")}${title}`;
}

/** 'div[role=row] > div > span[title]': from `top` down to `element` */
export function describePath(top: Element, element: Element): string {
  const chain: string[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    chain.unshift(describeElement(current));
    if (current === top) break;
  }
  return chain.join(" > ");
}

/** The elements inside that could take a click or focus */
export function describeInteractive(element: Element): string {
  return Array.from(element.querySelectorAll(INTERACTIVE))
    .slice(0, MAX_INTERACTIVE)
    .map(describeElement)
    .join(", ");
}
