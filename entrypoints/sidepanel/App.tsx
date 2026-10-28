import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { automationBlocks, BLOCK_MESSAGES, isHealthFresh } from "../../src/automation";
import { DEFAULT_DASHBOARD_URL } from "../../src/config";
import { LANGUAGE_FAILURE_KEY } from "../../src/dom/healthCheck";
import type { ExtensionMessage, SnapshotReply } from "../../src/messages";
import { SELECTORS, type SelectorKey } from "../../src/selectors";
import { connectionStatus, localKillSwitch, whatsappHealth } from "../../src/storage";
import type { ConnectionStatus, HealthState } from "../../src/types";
import { useStorageItem } from "../../src/ui/useStorageItem";

const WHATSAPP_URL = "https://web.whatsapp.com/";

type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_DOT: Record<Tone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-gray-300",
};

function Row({ tone, title, detail }: { tone: Tone; title: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="text-xs text-gray-500 break-words">{detail}</p>}
      </div>
    </div>
  );
}

function connectionRow(status: ConnectionStatus | null | undefined) {
  switch (status?.state) {
    case "connected":
      return {
        tone: "good" as Tone,
        title: "Connected to CareerCVPro",
        detail: status.config ? `As "${status.config.install.label}"` : undefined,
      };
    case "token_rejected":
      return { tone: "bad" as Tone, title: "Token rejected", detail: status.message };
    case "offline":
      return { tone: "warn" as Tone, title: "Can't reach CareerCVPro", detail: status.message };
    case "error":
      return { tone: "bad" as Tone, title: "CareerCVPro error", detail: status.message };
    case "no_token":
      return {
        tone: "neutral" as Tone,
        title: "Not set up",
        detail: "Create a token in CareerCVPro → WhatsApp → Settings, then add it in Options.",
      };
    default:
      return { tone: "neutral" as Tone, title: "Checking connection…" };
  }
}

function failureName(key: string): string {
  if (key === LANGUAGE_FAILURE_KEY) return "WhatsApp Web is not in English";
  return key in SELECTORS ? SELECTORS[key as SelectorKey].description : key;
}

function whatsappRow(health: HealthState | null | undefined) {
  if (!health || !isHealthFresh(health)) {
    return { tone: "neutral" as Tone, title: "WhatsApp Web is not open" };
  }
  if (health.pageState === "logged_out") {
    return { tone: "warn" as Tone, title: "WhatsApp Web is logged out" };
  }
  if (health.pageState === "loading") {
    return { tone: "neutral" as Tone, title: "WhatsApp Web is loading…" };
  }
  if (health.failures.length > 0) {
    return {
      tone: "bad" as Tone,
      title: "WhatsApp Web has changed",
      detail: `Not found: ${health.failures.map((failure) => failureName(failure.key)).join("; ")}`,
    };
  }
  return {
    tone: "good" as Tone,
    title: "WhatsApp Web looks right",
    detail: health.chatOpen
      ? "Chat list and open chat checked"
      : "Chat list checked; open a chat to check it too",
  };
}

async function saveSnapshot(): Promise<string> {
  const [tab] = await browser.tabs.query({ url: `${WHATSAPP_URL}*` });
  if (!tab?.id) return "Open WhatsApp Web first.";

  const message: ExtensionMessage = { type: "take-snapshot" };
  let reply: SnapshotReply | undefined;
  try {
    reply = (await browser.tabs.sendMessage(tab.id, message)) as SnapshotReply | undefined;
  } catch {
    // The tab was opened before the extension loaded
    reply = undefined;
  }
  if (!reply) return "The WhatsApp tab did not answer. Reload it and try again.";
  if ("error" in reply) return reply.error;

  const url = URL.createObjectURL(new Blob([reply.html], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `whatsapp-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "Saved. Check it before adding it to test/fixtures.";
}

export function App() {
  const { value: status } = useStorageItem(connectionStatus);
  const { value: health } = useStorageItem(whatsappHealth);
  const { value: localKill = false } = useStorageItem(localKillSwitch);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  // Re-render every 30 s so "not open" appears when the WhatsApp tab goes quiet
  const [, setTick] = useState(0);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const message: ExtensionMessage = { type: "refresh-connection" };
      await browser.runtime.sendMessage(message);
    } catch {
      // The status row shows whatever the service worker last recorded
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const message: ExtensionMessage = { type: "refresh-connection" };
    void browser.runtime.sendMessage(message).catch(() => undefined);
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const config = status?.state === "connected" ? status.config : status?.config;
  const dashboardUrl = config?.dashboard_url ?? DEFAULT_DASHBOARD_URL;
  const [firstBlock] = automationBlocks({ status, health, localKillSwitch: localKill });
  const connection = connectionRow(status);
  const whatsapp = whatsappRow(health);
  const version = browser.runtime.getManifest().version;

  return (
    <div className="flex min-h-screen flex-col gap-3 p-3 text-gray-800">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
            C
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">WhatsApp Assistant</p>
            <p className="text-[11px] text-gray-500 leading-tight">CareerCVPro · v{version}</p>
          </div>
        </div>
        <button
          onClick={() => void browser.runtime.openOptionsPage()}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Options
        </button>
      </header>

      {status?.updateRequired && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs">
          This extension is older than CareerCVPro requires
          {config ? ` (${config.min_extension_version})` : ""}. Update it to turn automation back
          on.
        </div>
      )}

      {/* Kill switch first: it must always be one click away */}
      <section
        className={`rounded-lg border p-3 ${localKill ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}
      >
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">Kill switch</span>
            <span className="block text-xs text-gray-500">
              Stops all automation from this computer immediately.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-red-600"
            checked={localKill}
            onChange={(event) => void localKillSwitch.setValue(event.target.checked)}
            aria-label="Kill switch"
          />
        </label>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white px-3 py-1">
        <Row {...connection} />
        <Row {...whatsapp} />
        <Row
          tone={firstBlock ? "neutral" : "good"}
          title={firstBlock ? "Automation off" : "Automation ready"}
          detail={firstBlock ? BLOCK_MESSAGES[firstBlock] : undefined}
        />
      </section>

      <div className="flex gap-2">
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshing ? "Checking…" : "Check again"}
        </button>
        {!health || !isHealthFresh(health) ? (
          <button
            onClick={() => void browser.tabs.create({ url: WHATSAPP_URL })}
            className="flex-1 rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:opacity-90"
          >
            Open WhatsApp Web
          </button>
        ) : (
          <a
            href={`${dashboardUrl}/whatsapp`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-md bg-brand px-3 py-1.5 text-center text-sm text-white hover:opacity-90"
          >
            Open CareerCVPro
          </a>
        )}
      </div>

      <details className="mt-auto rounded-lg border border-gray-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-gray-600">Developer tools</summary>
        <p className="mt-2 text-gray-500">
          Saves the structure of the WhatsApp Web page with names, numbers and messages removed, for
          the extension&apos;s tests.
        </p>
        <button
          onClick={() => void saveSnapshot().then(setSnapshotMessage)}
          className="mt-2 rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
        >
          Save scrubbed page snapshot
        </button>
        {snapshotMessage && <p className="mt-2 text-gray-600">{snapshotMessage}</p>}
      </details>
    </div>
  );
}
