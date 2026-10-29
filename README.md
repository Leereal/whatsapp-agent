# CareerCVPro WhatsApp Assistant (Chrome extension)

Runs on WhatsApp Web next to the CareerCVPro dashboard. It talks only to the
CareerCVPro API (`careercvpro/backend`, `/api/v1/whatsapp/ext`) with a
per-install token; it holds no API keys. Design and phases:
`careercvpro/backend/plan.md` and `careercvpro/backend/CLAUDE.md`.

Current phase: **3 (selective auto-send)**.

- **Pricing (phase 1).** The extension checks that WhatsApp Web still matches
  `src/selectors.ts`, reports labelled chats and new leads (unsaved numbers
  with unread messages and no label), and sends the pricing message:
  automatically when pricing auto-send is on and the chat is fresh, otherwise
  after you click **Send** in the side panel. Before sending it waits until
  you've been idle for 20 s, opens the chat, and skips it if you've written
  there before (Meta's ad greeting doesn't count).
- **Replies (phase 2).** The side panel's **Reply** card follows the chat you
  have open. **Draft a reply** reads its latest messages and asks CareerCVPro
  for a draft in your style. You edit it, add a saved message (pricing, CV
  request, payment details) and apply suggested order changes. **Insert** puts
  it in the message box for you to send; **Send** sends it. A draft for a
  complaint, refund or payment dispute hands the chat to you, which turns
  automation off for it. Messages of client chats are copied to CareerCVPro
  so the dashboard shows the conversation; other chats are never sent.
- **Automatic replies (phase 3).** Off until you tick kinds of message under
  _Automatic replies_ in the dashboard's WhatsApp settings. Then, when a client
  with an open order writes again, the scan answers "read": while you're idle
  the extension opens that chat (which marks it read in WhatsApp), reads it
  and sends it to CareerCVPro. A reply goes out by itself only for the ticked
  kinds, when the AI is sure enough; any other reply waits in the side panel
  with its text for **Send** or **Dismiss**. Payments, complaints, refunds,
  disputes and change requests always wait for you. Before sending, the
  extension checks that the client's message the reply answers is still the
  chat's last one, so a reply never lands after the conversation moved on.

| Path               | What                                                     |
| ------------------ | -------------------------------------------------------- |
| `src/agent.ts`     | Runs in WhatsApp Web: scanning, scheduling, manual-reply |
| `src/scanner.ts`   | Reports changed chat-list rows to the backend            |
| `src/scheduler.ts` | Runs due sends one at a time                             |
| `src/reader.ts`    | Reads client chats for automatic replies, one at a time  |
| `src/pageLock.ts`  | Keeps sending and reading from using the page at once    |
| `src/sender.ts`    | One send, step by step; any doubt stops it               |
| `src/copilot.ts`   | The open chat: sync, read for a draft, insert or send it |
| `src/dom/chat.ts`  | Open a chat, read messages, type, send, confirm          |

## Setup

```bash
npm install
npm run build        # production build → .output/chrome-mv3      (api.careercvpro.com)
npm run build:dev    # development build → .output/chrome-mv3-dev (localhost:5000)
```

1. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked**
   → choose `.output/chrome-mv3` (or `-dev`). Load only one: both use the same id.
2. In CareerCVPro → WhatsApp → Settings → **Chrome extension** → **New token**.
3. Click the extension icon → **Options** → paste the token → **Save**.
4. Open `https://web.whatsapp.com` (set to **English**) and open the side panel
   from the toolbar icon. You should see "Connected" and "WhatsApp Web looks right".

To update: pull, `npm run build`, then click the reload icon on the extension in
`chrome://extensions`. CareerCVPro can require a minimum version
(`whatsapp_min_extension_version`); older builds stop automating until updated.

## Extension id

The manifest's `key` pins the id to `fllcakgdcehlnnjjheomhiffhnbgdchm` on every
machine. The backend only accepts this origin:

```
WHATSAPP_EXTENSION_ORIGINS=chrome-extension://fllcakgdcehlnnjjheomhiffhnbgdchm
```

The private key is in `.keys/` (gitignored); it is only needed to sign a `.crx`.

## Layout

| Path                              | What                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| `entrypoints/background.ts`       | Service worker: the only part that calls the API; heartbeat every minute |
| `entrypoints/whatsapp.content.ts` | Runs in WhatsApp Web: health checks and snapshots (no network)           |
| `entrypoints/sidepanel/`          | Side panel: status, kill switch, reply drafts, queue, activity           |
| `entrypoints/options/`            | Token setup                                                              |
| `src/selectors.ts`                | **Every** WhatsApp Web selector, with fallbacks                          |
| `src/dom/healthCheck.ts`          | Checks the live page against the selectors                               |
| `src/dom/snapshot.ts`             | Scrubbed page snapshots for test fixtures                                |
| `src/automation.ts`               | Every reason automation is blocked (fails safe)                          |
| `src/shared/`                     | Generated from the backend; edit there and run `npm run sync:contract`   |

## When WhatsApp Web changes

The side panel shows "WhatsApp Web has changed", automation stops, the dashboard
shows a banner and Sentry emails a `selector_failure` alert.

1. Side panel → **Developer tools** → **Save scrubbed page snapshot**.
2. Check the file contains no client details, then add it to `test/fixtures/`.
3. Fix the candidates in `src/selectors.ts` and add a test against the new fixture.

## Checks

```bash
npm run typecheck && npm run lint && npm test
```
