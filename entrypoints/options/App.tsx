import { useState } from "react";
import { browser } from "wxt/browser";
import { API_BASE_URL } from "../../src/config";
import type { ExtensionMessage } from "../../src/messages";
import { connectionStatus, installToken } from "../../src/storage";
import type { ConnectionStatus } from "../../src/types";
import { useStorageItem } from "../../src/ui/useStorageItem";

function describe(status: ConnectionStatus | null | undefined): { ok: boolean; text: string } {
  switch (status?.state) {
    case "connected":
      return {
        ok: true,
        text: `Connected as "${status.config?.install.label}" (${status.config?.install.environment}).`,
      };
    case "no_token":
      return { ok: false, text: "No token saved yet." };
    case undefined:
      return { ok: false, text: "Not checked yet." };
    default:
      return { ok: false, text: status?.message ?? "Could not connect." };
  }
}

export function App() {
  const { value: savedToken } = useStorageItem(installToken);
  const { value: status } = useStorageItem(connectionStatus);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectionStatus | null>(null);

  const send = async (message: ExtensionMessage) => {
    setBusy(true);
    try {
      setResult((await browser.runtime.sendMessage(message)) as ConnectionStatus);
    } catch {
      setResult({
        state: "error",
        message: "The extension's background service did not respond. Try again.",
        updateRequired: false,
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    await send({ type: "save-token", token });
    setToken("");
  };

  const shown = describe(result ?? status);

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6 text-gray-800">
      <header>
        <h1 className="text-xl font-semibold">WhatsApp Assistant</h1>
        <p className="text-sm text-gray-500">Connect this computer to CareerCVPro.</p>
      </header>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-medium">Extension token</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
          <li>In CareerCVPro, open WhatsApp → Settings.</li>
          <li>Under Chrome extension, click New token and copy it.</li>
          <li>Paste it here and save.</li>
        </ol>
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && token && void save()}
            placeholder={
              savedToken ? "A token is saved; paste a new one to replace it" : "cvp_wa_…"
            }
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
          />
          <button
            onClick={() => void save()}
            disabled={!token.trim() || busy}
            className="rounded-md bg-brand px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
        <p className={`text-sm ${shown.ok ? "text-emerald-700" : "text-gray-600"}`}>{shown.text}</p>
        <div className="flex gap-3 text-sm">
          <button
            onClick={() => void send({ type: "refresh-connection" })}
            disabled={busy || !savedToken}
            className="underline disabled:opacity-50"
          >
            Test connection
          </button>
          {savedToken && (
            <button
              onClick={() => void send({ type: "clear-token" })}
              disabled={busy}
              className="text-red-600 underline disabled:opacity-50"
            >
              Remove token
            </button>
          )}
        </div>
      </section>

      <section className="space-y-1 rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <h2 className="font-medium">About this install</h2>
        <p className="text-gray-600">
          Backend: <code className="text-xs">{API_BASE_URL}</code>
        </p>
        <p className="text-gray-600">
          Extension id: <code className="text-xs">{browser.runtime.id}</code>
        </p>
        <p className="text-xs text-gray-500">
          The backend only accepts requests from this id (WHATSAPP_EXTENSION_ORIGINS).
        </p>
      </section>
    </main>
  );
}
