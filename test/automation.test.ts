import { automationBlocks } from "../src/automation";
import type { ExtensionConfig } from "../src/shared/contract";
import type { ConnectionStatus, HealthState } from "../src/types";
import { compareVersions, isOlderThan } from "../src/version";

const now = Date.parse("2026-10-28T10:00:00Z");

const config: ExtensionConfig = {
  install: { id: "i", label: "Office PC", environment: "production" },
  enabled: true,
  kill_switch: false,
  auto_send_types: ["pricing"],
  delay_min_seconds: 20,
  delay_max_seconds: 90,
  missed_chat_minutes: 30,
  min_extension_version: "0.1.0",
  dashboard_url: "https://careercvpro.com",
};

const connected: ConnectionStatus = {
  state: "connected",
  config,
  updateRequired: false,
  checkedAt: new Date(now).toISOString(),
};

const healthy: HealthState = {
  pageState: "ready",
  chatOpen: false,
  failures: [],
  checkedAt: new Date(now - 10_000).toISOString(),
};

const blocks = (overrides: Partial<Parameters<typeof automationBlocks>[0]> = {}) =>
  automationBlocks({
    status: connected,
    health: healthy,
    localKillSwitch: false,
    now,
    ...overrides,
  });

describe("automationBlocks", () => {
  it("allows automation only when everything is in order", () => {
    expect(blocks()).toEqual([]);
  });

  it("blocks when anything is unknown (fail safe)", () => {
    expect(blocks({ status: undefined, health: undefined })).toEqual([
      "not_connected",
      "whatsapp_closed",
    ]);
  });

  it("blocks on either kill switch", () => {
    expect(blocks({ localKillSwitch: true })).toEqual(["local_kill_switch"]);
    expect(blocks({ status: { ...connected, config: { ...config, kill_switch: true } } })).toEqual([
      "server_kill_switch",
    ]);
  });

  it("blocks when the assistant is off or the extension is outdated", () => {
    expect(blocks({ status: { ...connected, config: { ...config, enabled: false } } })).toEqual([
      "assistant_off",
    ]);
    expect(blocks({ status: { ...connected, updateRequired: true } })).toEqual(["update_required"]);
  });

  it("blocks when the connection is lost, even with a remembered config", () => {
    expect(blocks({ status: { ...connected, state: "offline" } })).toEqual(["not_connected"]);
  });

  it("blocks on WhatsApp Web problems", () => {
    expect(blocks({ health: { ...healthy, pageState: "logged_out" } })).toEqual(["logged_out"]);
    expect(
      blocks({ health: { ...healthy, failures: [{ key: "composer", candidates_tried: 4 }] } }),
    ).toEqual(["page_changed"]);
    expect(
      blocks({ health: { ...healthy, checkedAt: new Date(now - 5 * 60_000).toISOString() } }),
    ).toEqual(["whatsapp_closed"]);
  });
});

describe("versions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBe(-1);
    expect(isOlderThan("0.1.0", "0.2.0")).toBe(true);
    expect(isOlderThan("0.2.0-beta.1", "0.2.0")).toBe(false);
  });
});
