# WhatsApp AI Assistant Suite — Project Summary

Technical overview of the current codebase (aligned with `AGENTS.md`).

Product version: root **`version.json`** (1.0.0, channel stable, productId `dev.waassistant.suite`).

## Architecture

npm workspaces monorepo with three apps:

### 1. Core Engine — `apps/core-engine`

- HTTP + Socket.IO (default **:3001**)
- WhatsApp via `whatsapp-web.js` + Puppeteer (system Chrome; `headless: 'new'`)
- Prisma/SQLite for config, logs, policies, approvals
- Embed API: `startEngine` / `stopEngine` for desktop
- Portable paths (`paths.js`), shared DB (`db.js`), version meta (`appMeta.js`)

| Module | Responsibility |
| :--- | :--- |
| `server.js` | WA lifecycle, re-pair, routes, static UI mount, watchdog |
| `services/ollamaAgent.js` | Incoming pipeline / tools / dispatch (provider-agnostic) |
| `services/llmProvider.js` | Multi-provider chat + vendor wire formats |
| `services/calendarProvider.js` | Calendar/tasks backends |
| `services/contactPolicy.js` | Policies + approval CRUD |
| `services/google.js` / `googleOauth.js` | Google APIs + OAuth |

### 2. Web Control Center — `apps/web-control-center`

- Next.js App Router; static export for desktop (`output: 'export'`)
- Browser dev on **:3000**; desktop loads engine-served `out/`
- Native-style shell: sidebar (`AppShell`), version chrome (`AppChrome`)
- macOS graphite dark theme + system accents
- Settings: LLM, Calendar, Contacts, Approvals, System & Updates
- Configurable API base (`lib/apiBase.js`)

### 3. Desktop — `apps/desktop`

- Electron main embeds core-engine with OS `userData`
- Dev: `run-dev.mjs` launches **stock** Electron (stable); menu may say “Electron”
- Prod naming via electron-builder `productName` / CFBundleName
- Icons: `build/icon.icns`, entitlements template for future signing
- Packaging note: full DMG still needs engine dependency staging for offline runs

### 4. Shared

- Root scripts: `dev`, `stop`, `desktop`, `build:ui`, Prisma
- `packages/` reserved

## Domain model (Prisma)

| Model | Purpose |
| :--- | :--- |
| `Config` | Bot on/off + custom context |
| `ConversationLog` | Message/response audit |
| `LLMConfig` | Provider, model, key, baseUrl |
| `CalendarConfig` | Calendar + tasks backend |
| `ContactPolicy` | Tone, info level, topics, approval, instructions |
| `PendingApproval` | pending / approved / rejected / sent |

Runtime DB is gitignored. Schema uses `env("DATABASE_URL")`.

## Operational flow

1. **Connect** — clear locks → initialize WA → QR or READY (watchdog + state poll)
2. **Receive** — filter non-DM noise → agent
3. **Govern** — contact policy
4. **Decide** — `llmChat` + optional tools
5. **Approve** — optional queue
6. **Send + log**
7. **Observe** — dashboard Socket.IO + REST

### Re-pair / logout

`POST /api/logout`: stop watchdog → logout → destroy client → **delete LocalAuth directory** → new client → initialize → wait for **new QR**. Spurious `authenticated` before QR is ignored. UI treats only `READY` as connected.

## LLM layer

| Concern | Behavior |
| :--- | :--- |
| Contract | `{ messages, tools }` → `{ message: { content, tool_calls? } }` |
| Config | Prisma `LLMConfig`; short cache; keys masked |
| Ollama / Gemini / Claude / OpenAI / Grok | Adapters in `llmProvider.js` only |
| Failures | Surface; no auto cross-provider fallback |

## WhatsApp process lifecycle

- Absolute LocalAuth under active data dir
- Puppeteer app-owned signals
- Shutdown: destroy + Prisma disconnect + HTTP close
- Lock cleanup + one retry on “browser already running”
- Root `npm run stop` clears ports 3000/3001 and session-bound Chromium

## Integrations

| Integration | Notes |
| :--- | :--- |
| LLM | Ollama default; cloud keys in DB |
| Google | OAuth redirect `http://localhost:3001/api/calendar/google-auth/callback` |
| macOS | Calendar + Reminders (AppleScript) |
| Windows | Outlook (PowerShell) |

## API surface (engine)

- `GET/POST /api/state`, `POST /api/logout`
- Logs, LLM/calendar config, Google OAuth
- Contact policies, approvals
- `GET /api/system` — version, paths, durability, upgrade history
- Debug / screenshot
- Socket.IO `state`, `live_log`, `approval_request`
- Optional static UI (`/`, `/settings/`)

## Dev commands

```bash
npm install && npm run prisma:generate && npm run db:push
npm run dev                 # browser stack
npm run build:ui && npm run dev:desktop:fast
npm run stop && npm run restart
```

## Source of truth files

- `apps/core-engine/src/server.js` — WA + HTTP + embed
- `apps/core-engine/src/paths.js`, `db.js`, `appMeta.js`
- `apps/core-engine/prisma/schema.prisma`
- `apps/core-engine/src/services/*`
- `apps/web-control-center/app/{page.js,settings/page.js,components/*,globals.css}`
- `apps/desktop/{main.mjs,run-dev.mjs,preload.cjs,package.json,build/}`
- `version.json`, root `package.json`, `.gitignore`

### Docs

- `AGENTS.md` — single source of truth for agents
- `README.md` — human setup
- `project summary.md` (this file) — technical overview
- `CLAUDE.md` — thin pointer to AGENTS
