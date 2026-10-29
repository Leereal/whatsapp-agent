import { browser } from "wxt/browser";
import type { ApiErrorKind } from "./api";
import type { ApiReply, ExtensionMessage } from "./messages";

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind | "unavailable",
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

/**
 * Ask the service worker to call the CareerCVPro API (content scripts and
 * pages never call it directly). Throws BridgeError when the call failed.
 */
export async function callBackground<T>(message: ExtensionMessage): Promise<T> {
  let reply: ApiReply<T> | undefined;
  try {
    reply = (await browser.runtime.sendMessage(message)) as ApiReply<T> | undefined;
  } catch {
    throw new BridgeError("The extension's background service is not available", "unavailable");
  }
  if (!reply) throw new BridgeError("No answer from the background service", "unavailable");
  if (!reply.ok) throw new BridgeError(reply.error, reply.kind);
  return reply.data;
}
