# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Architecture

npm **workspaces** monorepo (`apps/*`, product version **1.0.0** in root `version.json`).

**Runtime loop:** WhatsApp DM → contact policy → LLM draft (optional calendar/task tools) → auto-send or approval queue → conversation log.

| Path | Role |
| :--- | :--- |
| `apps/core-engine` | Backend (default **:3001**) — WhatsApp (`whatsapp-web.js` + Puppeteer/Chrome), Express REST, Socket.IO, Prisma/SQLite |
| `apps/web-control-center` | Next.js control center — macOS-style shell UI. Dev **:3000**; static export `out/` for desktop |
| `apps/desktop` | Electron shell (macOS + Windows) — embeds engine + static UI on one origin |
| `packages/` | Reserved shared utils; empty today |
| `version.json` | Canonical `version`, `schemaVersion`, `channel`, `productId` |

**Operator modes**

1. **Browser dev** — `npm run dev` (engine + Next on 3000/3001)
2. **Desktop dev** — `npm run dev:desktop` / `dev:desktop:fast` (stock Electron + `userData` DB)

### Core engine

**Entrypoint / embed API:** `apps/core-engine/src/server.js`

```js
import { startEngine, stopEngine } from './server.js';
// startEngine({ dataDir, port, host, initWhatsApp, exitProcessOnSignal, staticUiDir })
// stopEngine({ exitProcess })  // true only for CLI
```

- CLI: `npm run dev:engine` → `0.0.0.0:3001`
- Exports: `.`, `./server`, `./paths`, `./db`

| Module | Role |
| :--- | :--- |
| `src/paths.js` | Portable data dir, Chrome path, session lock cleanup (mac/win/linux) |
| `src/db.js` | Shared Prisma + first-run `ensureDatabaseSchema()` |
| `src/appMeta.js` | Version + `{dataDir}/app-meta.json` upgrade history (never wipes user data) |
| `src/services/ollamaAgent.js` | Message/tools/dispatch — **provider-agnostic** |
| `src/services/llmProvider.js` | Multi-provider `llmChat` + vendor adapters only |
| `src/services/calendarProvider.js` | google \| macos \| windows |
| `src/services/contactPolicy.js` | Policies + approvals |
| `src/services/google.js` / `googleOauth.js` | Google Calendar/Tasks + OAuth |

### Message flow

1. Connect — clear Chromium locks; `LocalAuth` under data-dir `.wwebjs_auth`; QR → READY (watchdog + `change_state`)
2. Receive — filter groups/status/self/empty/pre-startup
3. Govern — tone, info level, restricted topics, `requiresApproval`
4. Decide — `llmChat({ messages, tools })`; calendar/task tools optional
5. Approve (optional) — `PendingApproval` → edit/send
6. Log — `ConversationLog`

### LLM contract

- `llmChat({ messages, tools })` → `{ message: { content, tool_calls? } }`
- Do **not** branch agent loop on provider; vendor quirks only in `llmProvider.js`
- Gemini: `systemInstruction` on `getGenerativeModel()`; Claude tool ids; OpenAI/Grok `tool_call_id`
- No invented cross-provider fallback

### Portable data

| Asset | Browser dev default | Desktop / custom `WA_ASSISTANT_DATA_DIR` |
| :--- | :--- | :--- |
| SQLite | `apps/core-engine/prisma/data.db` | `{dataDir}/data.db` |
| WA session | `apps/core-engine/.wwebjs_auth` | `{dataDir}/.wwebjs_auth` |
| Google | `credentials.json` / `token.json` under data root | same |
| App meta | `{dataDir}/app-meta.json` | same |

Env: `WA_ASSISTANT_DATA_DIR`, `DATABASE_URL` (auto), `WA_ENGINE_PORT/HOST`, `WA_UI_ORIGIN`, `WA_STATIC_UI_DIR`, `PUPPETEER_EXECUTABLE_PATH`, `WA_PUPPETEER_HEADLESS`, `WA_APP_VERSION`, `WA_VERSION_FILE`, `WA_UPDATE_*`, `GOOGLE_OAUTH_*`.

### WhatsApp lifecycle (critical)

- **Init:** Puppeteer `headless: 'new'` (or `WA_PUPPETEER_HEADLESS=false`); ready watchdog; only `READY` means linked
- **Re-pair (`POST /api/logout`):** destroy client → **delete LocalAuth dir** → new client → fresh QR; ignore spurious `authenticated` until QR seen
- **UI:** `isConnected` only when `connectionStatus === 'READY'`; poll `/api/state` + Socket.IO
- Prefer `npm run stop` / Ctrl+C; do not wipe auth unless re-pairing

### Engine API (`:3001`)

- `GET/POST /api/state`, `POST /api/logout` (full session clear + re-pair)
- `GET/POST /api/logs`, `llm-config`, `calendar-config`
- Google OAuth init/callback
- Contact policies + approvals
- `GET /api/system` — version, paths, durability, upgrade history
- `GET /api/debug`, `/api/screenshot`
- Socket.IO: `state`, `live_log`, `approval_request`
- Static UI when `staticUiDir` set

### Web control center

- **Shell:** `AppShell.js` — collapsible sidebar, toolbar, native chrome
- **Chrome:** `AppChrome.js` — version pill, footer, System panel
- **API base:** `lib/apiBase.js` — same-origin / `__WA_API_BASE__` / `127.0.0.1:3001`
- Settings tabs: LLM, Calendar, Contacts, Approvals, **System & Updates**
- Theme: macOS graphite dark (`#1c1c1e` / `#2c2c2e`) + system accents; light mode
- `next.config.mjs`: `output: 'export'`, `trailingSlash: true` → `out/`
- No Next API routes / no Prisma in UI

### Desktop (`apps/desktop`)

| File | Role |
| :--- | :--- |
| `run-dev.mjs` | Dev launcher — **stock** Electron binary (`electron .`); do not rename Electron.app (breaks ICU/GPU) |
| `main.mjs` | `userData` paths, `startEngine`, window (`titleBarStyle: hidden` + traffic lights), dock icon, About |
| `preload.cjs` | Injects `__WA_API_BASE__` |
| `build/icon.icns` / `icon.png` | App icons |
| `build/entitlements.mac.plist` | Signing template |

- **Dev menu bar** may show “Electron” (stock binary). **Packaged** builds use `productName` / `CFBundleName` = WA Assistant Suite
- electron-builder: mac DMG/zip arm64, win NSIS; `appId` `dev.waassistant.suite` (keep stable)
- **Packaging gap:** production DMG still needs staged `node_modules` for engine deps — prefer `dev:desktop` for local testing until pack pipeline is complete

### Versioning (upgrade-safe)

- Bump `version.json` only; never change `productId` casually
- Binary replace does **not** delete DB, WA session, OAuth, policies
- History in `app-meta.json`

## Commands

| Task | Command |
| :--- | :--- |
| Install | `npm install` |
| Prisma | `npm run prisma:generate` / `npm run db:push` |
| Browser both | `npm run dev` |
| Engine / web only | `npm run dev:engine` / `dev:web` |
| Static UI | `npm run build:ui` |
| Desktop | `npm run dev:desktop` or `dev:desktop:fast` |
| Package | `npm run build:desktop:mac` / `build:desktop:win` |
| Stop / restart | `npm run stop` / `restart` |
| Ollama model | `ollama pull <model>` |
| **T0 smoke** | `npm run test:smoke` |
| **Unit + API** | `npm test` |
| Unit / API / UI | `npm run test:unit` / `test:api` / `test:ui` |
| All automated | `npm run test:all` |

No root `lint`. `setup:auth` script target is **missing** — ignore.

## Validation gate (before every fix/enhancement push)

Full case catalog: **`docs/TEST_MATRIX.md`** (IDs A–K, tiers T0–T5).

1. Map the diff to domains in the matrix (paths, WA, agent, policy, LLM, calendar, UI, desktop, security, regressions).
2. **Always** run `npm run test:smoke` (T0).
3. Run `npm test` (T1+T2) for engine/API/logic changes; add `npm run test:ui` or `npm run test:all` when UI/desktop launcher changes.
4. Rebuild UI (`npm run build:ui`) if `apps/web-control-center` changed and desktop will be used.
5. T5 live cases (real WA QR, Google OAuth, OS calendar permissions): execute manually or mark **N/A** with reason — never claim pass without evidence.
6. Tests must use temp data dirs only (see `tests/helpers/engineHarness.js`); never point automated runs at real userData/sessions/tokens.
7. Include a short **Validation report** in the PR/commit body (tiers + case IDs pass/fail/skip).

Do not push when T0/T1/T2 fail for touched domains.

After wiped `node_modules`: regenerate Prisma; ensure Electron binary installed (`path.txt` + full `Electron.app`).

## Agent working rules

1. Prefer root scripts.
2. Approval/policy on **engine send path**, not UI-only.
3. Provider quirks only in `llmProvider.js`.
4. WA issues → `server.js` / `paths.js`; full re-pair clears LocalAuth.
5. Never commit secrets, sessions, `*.db`, `.next`, `out/`, `release/`, `.runtime/`.
6. Desktop data under Electron `userData` or `WA_ASSISTANT_DATA_DIR`.
7. Do not ship writable DB inside the app bundle.
8. Dev desktop: use stock Electron launcher only.

## Critical files

| Path | Why |
| :--- | :--- |
| `apps/core-engine/src/server.js` | WA lifecycle, re-pair, APIs, embed |
| `apps/core-engine/src/paths.js` | Portable paths |
| `apps/core-engine/src/db.js` | Prisma |
| `apps/core-engine/src/appMeta.js` | Versioning |
| `apps/core-engine/src/services/*` | Domain logic |
| `apps/web-control-center/app/page.js` | Dashboard |
| `apps/web-control-center/app/settings/page.js` | Settings |
| `apps/web-control-center/app/components/AppShell.js` | Native shell |
| `apps/web-control-center/app/components/AppChrome.js` | Version / System UI |
| `apps/web-control-center/app/globals.css` | Themes (macOS graphite dark) |
| `apps/desktop/main.mjs` | Electron main |
| `apps/desktop/run-dev.mjs` | Stable dev launcher |
| `version.json` | Product version |
| `package.json` | Scripts |

## Related docs

- This file — agent SoT
- `docs/TEST_MATRIX.md` — pre-push test catalog + gate
- `README.md` — human setup
- `project summary.md` — technical overview
- `CLAUDE.md` — points here
