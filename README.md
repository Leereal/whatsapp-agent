# CareerCVPro WhatsApp Assistant (Chrome extension)

Runs on WhatsApp Web next to the CareerCVPro dashboard. It talks only to the
CareerCVPro API (`careercvpro/backend`, `/api/v1/whatsapp/ext`) with a
per-install token; it holds no API keys. Design and phases:
`careercvpro/backend/plan.md` and `careercvpro/backend/CLAUDE.md`.

Current phase: **0 (foundation)**. The extension connects, checks that WhatsApp
Web still matches `src/selectors.ts`, and reports health. It does not send
anything yet.

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
| `entrypoints/sidepanel/`          | Side panel: connection, WhatsApp health, kill switch                     |
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
