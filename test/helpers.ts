import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Parse an HTML fixture from test/fixtures into its own document (vitest runs from the project root) */
export function loadFixture(name: string): Document {
  const html = readFileSync(join(process.cwd(), "test", "fixtures", name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}
