import type { ExtensionConfig, SelectorFailure } from "./shared/contract";

/** What WhatsApp Web is showing */
export type PageState = "loading" | "logged_out" | "ready";

/** Result of one selector health check, reported by the content script */
export interface HealthState {
  pageState: PageState;
  /** A chat is open, so the conversation selectors were checked too */
  chatOpen: boolean;
  failures: SelectorFailure[];
  checkedAt: string;
}

export type ConnectionState = "no_token" | "connected" | "token_rejected" | "offline" | "error";

/** The extension's link to CareerCVPro, kept by the service worker */
export interface ConnectionStatus {
  state: ConnectionState;
  message?: string;
  config?: ExtensionConfig;
  /** This build is older than the backend's minimum version */
  updateRequired: boolean;
  checkedAt: string;
}
