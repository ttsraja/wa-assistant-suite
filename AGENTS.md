# AGENTS.md

Guidance for coding agents working in this repository.

***

## Architectural Overview

The WhatsApp AI Assistant Suite is an npm **workspaces** monorepo. The core loop is: receive a WhatsApp DM → apply contact policy → generate an LLM draft (optional tools for calendar/tasks) → auto-send or hold in the approval queue → log the outcome.

**Primary modules**

1. **`apps/core-engine`** (backend, port **3001**)
   - WhatsApp Web client (`whatsapp-web.js` + Puppeteer/Chrome)
   - Express REST API + Socket.IO live `state`
   - Prisma/SQLite persistence
   - Orchestrates LLM, calendar/tasks, policies, approvals, outbound sends
   - Entrypoint: `src/server.js`

2. **`apps/web-control-center`** (Next.js UI, port **3000**)
   - Dashboard for connection status, QR, logs, settings, approval queue
   - Talks to core-engine over REST/Socket.IO only (no direct WhatsApp access)

3. **`packages/`**
   - Reserved for shared non-UI utilities; runtime logic today lives under `apps/core-engine`

**Core engine services** (`apps/core-engine/src/services/`)

| File | Role |
| :--- | :--- |
| `ollamaAgent.js` | Incoming message pipeline, tools, reply dispatch |
| `llmProvider.js` | Multi-provider chat (ollama \| gemini \| claude \| openai \| grok) |
| `calendarProvider.js` | Calendar read + task write backends |
| `contactPolicy.js` | Per-contact rules + pending approval CRUD |
| `google.js` | Google Calendar/Tasks API |
| `googleOauth.js` | Google OAuth init/callback + local tokens |

***

## System Domains

Configured in the web UI and consumed by the core-engine:

* **LLM integration**
  * Providers: `ollama`, `gemini`, `claude`, `openai`, `grok`
  * Stored in Prisma `LLMConfig` (API keys masked in GET responses)
  * Failures should surface clearly to logs/UI; do not invent a fallback provider unless one is configured

* **Calendar & tasks**
  * Backends: Google, macOS (AppleScript), Windows/Outlook (PowerShell)
  * Google OAuth redirect: `http://localhost:3001/api/calendar/google-auth/callback`
  * Secrets: `apps/core-engine/credentials.json`, `token.json` (gitignored) or `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`

* **Contact policies**
  * Tone (`auto` \| `formal` \| `casual` \| …), info level (`full` \| `limited` \| `minimal`)
  * Restricted topics, custom instructions, `requiresApproval`

* **Approval queue**
  * `PendingApproval` rows; approve may include an edited draft before WhatsApp send

***

## Data & Prisma

- Schema: `apps/core-engine/prisma/schema.prisma`
- Local DB: `apps/core-engine/prisma/data.db` (**gitignored** — do not commit)
- Models: `Config`, `ConversationLog`, `LLMConfig`, `CalendarConfig`, `ContactPolicy`, `PendingApproval`
- After `npm install` / wiped `node_modules`, Prisma client must exist:

```bash
npm run prisma:generate
# or rely on apps/core-engine postinstall
npm run db:push   # apply schema to SQLite
```

If the engine crashes with `@prisma/client did not initialize yet`, run `npm run prisma:generate`.

***

## Core Development Commands

Run from the **repository root** unless noted.

| Task | Command | Description |
| :--- | :--- | :--- |
| **Setup** | `npm install` | Install workspace deps; core-engine `postinstall` runs `prisma generate` |
| **Generate Prisma client** | `npm run prisma:generate` | Regenerate `@prisma/client` after install or schema changes |
| **Push DB schema** | `npm run db:push` | `prisma db push` for local SQLite |
| **Run both apps** | `npm run dev` | Concurrently engine (:3001) + web (:3000) |
| **Engine only** | `npm run dev:engine` | WhatsApp + API (`node --watch-path=src`) |
| **Web only** | `npm run dev:web` | Next.js control center |
| **Stop** | `npm run stop` | SIGTERM then kill ports 3000/3001; kill session-bound Chromium |
| **Restart** | `npm run restart` | `stop` → wait → `dev` |
| **Auth helper** | `npm run setup:auth` | `apps/core-engine/src/scripts/setup_auth.js` |
| **Local LLM model** | `ollama pull <model>` | e.g. `ollama pull gemma4:latest` when provider is Ollama |

There is **no** root `lint` / `test` script in the current package.json. Do not assume they exist unless added.

***

## WhatsApp Session Lifecycle (important)

Session dir: `apps/core-engine/.wwebjs_auth/` (gitignored).

Hard stops used to leave Chromium locking `userDataDir`, causing:

> The browser is already running for …/session

Engine behavior now:

- Absolute `LocalAuth` path; Puppeteer signal handlers disabled so the app owns shutdown
- `SIGINT` / `SIGTERM` / `SIGHUP` → `client.destroy()`, Prisma disconnect, HTTP close
- Before `initialize()`: kill only processes bound to this session path; remove Chromium `Singleton*` / `DevToolsActivePort` locks
- One automatic retry on “browser already running”
- Prefer `npm run stop` or Ctrl+C over `kill -9`

When changing WA init/shutdown, keep this cleanup path intact.

***

## System Context Notes

* **State:** Bot config, LLM/calendar settings, policies, approvals, and logs live in SQLite via Prisma — not in git.
* **Secrets:** Never commit `.env*`, `credentials.json`, `token.json`, session folders, or `*.db`.
* **API boundary:** UI must use core-engine REST/Socket.IO only. Do not call WhatsApp or Prisma from the Next app.
* **Message filters:** Engine ignores groups, status/broadcast, self messages, empty bodies, and pre-startup timestamps.
* **Ports:** Web `3000`, engine `3001`. Stop scripts target these ports.

***

## Critical Files

| Path | Why |
| :--- | :--- |
| `apps/core-engine/src/server.js` | WA client lifecycle, HTTP routes, Socket.IO, shutdown |
| `apps/core-engine/prisma/schema.prisma` | Data model |
| `apps/core-engine/src/services/llmProvider.js` | LLM providers |
| `apps/core-engine/src/services/ollamaAgent.js` | Message/agent loop |
| `apps/core-engine/src/services/contactPolicy.js` | Policies + approvals |
| `apps/core-engine/src/services/calendarProvider.js` | Calendar/tasks backends |
| `apps/core-engine/src/services/googleOauth.js` | Google OAuth |
| `apps/web-control-center/app/page.js` | Main dashboard |
| `apps/web-control-center/app/settings/page.js` | Operator settings UI |
| `package.json` | Workspace scripts |
| `.gitignore` | Sessions, secrets, DB, build artifacts |
| `README.md` | Human setup guide |
| `project summary.md` | Architecture / flow reference |

***

## Agent Working Rules

1. Prefer root scripts (`npm run dev:engine`, `npm run prisma:generate`) over ad-hoc paths.
2. After dependency reinstalls, ensure Prisma client is generated before running the engine.
3. Do not commit runtime artifacts (`.next`, `node_modules`, `.wwebjs_auth`, `data.db`, OAuth tokens).
4. Keep approval and policy checks on the send path — UI changes alone are not sufficient.
5. For WhatsApp restart issues, fix lifecycle/locks in `server.js`; do not delete the whole auth folder unless the user explicitly wants to re-pair QR.
