import type { ConnectionStatus, HealthState } from "./types";

/** Messages between the content script, side panel, options page and service worker */
export type ExtensionMessage =
  /** content script → service worker, after every health check */
  | { type: "health-report"; health: HealthState }
  /** side panel / options → service worker; answers with ConnectionStatus */
  | { type: "refresh-connection" }
  /** options → service worker; validates and stores the token, answers with ConnectionStatus */
  | { type: "save-token"; token: string }
  /** options → service worker */
  | { type: "clear-token" }
  /** side panel → content script; answers with { html } */
  | { type: "take-snapshot" };

export type ConnectionReply = ConnectionStatus;
export type SnapshotReply = { html: string } | { error: string };
