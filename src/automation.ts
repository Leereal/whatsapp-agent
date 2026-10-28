import { HEALTH_STALE_MS } from "./config";
import type { ConnectionStatus, HealthState } from "./types";

/** Every reason automation may not run right now, most fundamental first */
export type AutomationBlock =
  | "not_connected"
  | "update_required"
  | "assistant_off"
  | "server_kill_switch"
  | "local_kill_switch"
  | "whatsapp_closed"
  | "logged_out"
  | "loading"
  | "page_changed";

export const BLOCK_MESSAGES: Record<AutomationBlock, string> = {
  not_connected: "Not connected to CareerCVPro",
  update_required: "This extension version is too old; update it",
  assistant_off: "The WhatsApp assistant is turned off in CareerCVPro",
  server_kill_switch: "Stopped by the kill switch in CareerCVPro",
  local_kill_switch: "Stopped by the kill switch here",
  whatsapp_closed: "WhatsApp Web is not open",
  logged_out: "WhatsApp Web is logged out",
  loading: "WhatsApp Web is still loading",
  page_changed: "WhatsApp Web has changed; automation is paused for safety",
};

export function isHealthFresh(health: HealthState | null | undefined, now = Date.now()): boolean {
  return Boolean(health && now - new Date(health.checkedAt).getTime() < HEALTH_STALE_MS);
}

/** Empty when automation may run. Fails safe: anything unknown blocks. */
export function automationBlocks(input: {
  status: ConnectionStatus | null | undefined;
  health: HealthState | null | undefined;
  localKillSwitch: boolean;
  now?: number;
}): AutomationBlock[] {
  const blocks: AutomationBlock[] = [];
  const { status, health, localKillSwitch } = input;
  const config = status?.state === "connected" ? status.config : undefined;

  if (!config) blocks.push("not_connected");
  if (status?.updateRequired) blocks.push("update_required");
  if (config && !config.enabled) blocks.push("assistant_off");
  if (config?.kill_switch) blocks.push("server_kill_switch");
  if (localKillSwitch) blocks.push("local_kill_switch");

  if (!health || !isHealthFresh(health, input.now)) blocks.push("whatsapp_closed");
  else if (health.pageState === "logged_out") blocks.push("logged_out");
  else if (health.pageState === "loading") blocks.push("loading");
  else if (health.failures.length > 0) blocks.push("page_changed");

  return blocks;
}
