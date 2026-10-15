# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Architecture

npm **workspaces** monorepo (`apps/*`). Runtime loop: WhatsApp DM → contact policy → LLM draft (optional calendar/task tools) → auto-send or approval queue → conversation log.

| Path | Role |
| :--- | :--- |
| `apps/core-engine` | Backend **:3001** — WhatsApp (`whatsapp-web.js` + Puppeteer/Chrome), Express REST, Socket.IO `state`, Prisma/SQLite, orchestration |
| `apps/web-control-center` | Next.js **:3000** — live status/QR, logs, settings, approval queue. Talks to engine over REST/Socket.IO only (no WhatsApp or Prisma) |
| `packages/` | Reserved for shared non-UI utilities; empty/placeholder today — logic lives in core-engine |

**Entrypoint:** `apps/core-engine/src/server.js` — WA client lifecycle, HTTP routes, Socket.IO, graceful shutdown, in-memory `botState` synced from Prisma `Config`.

### Message flow

1. Connect — clear stale Chromium session locks, `LocalAuth` under `.wwebjs_auth`, emit QR / READY via Socket.IO
2. Receive — `message_create`; ignore groups, status/broadcast, self, empty bodies, pre-startup timestamps
3. Govern — `contactPolicy` (tone, info level, restricted topics, `requiresApproval`, custom instructions)
4. Decide — `ollamaAgent.handleIncomingMessage` → `llmChat({ messages, tools })`; tools may read calendar / create tasks
5. Approve (optional) — `PendingApproval`; UI approve (optional edit) / reject → `dispatchApprovedReply`
6. Send + log — WhatsApp send + `ConversationLog`

### Core engine services (`apps/core-engine/src/services/`)

| File | Role |
| :--- | :--- |
| `ollamaAgent.js` | Incoming pipeline, tool loop, reply dispatch — **provider-agnostic** |
| `llmProvider.js` | Multi-provider `llmChat` + vendor wire-format adapters only |
| `calendarProvider.js` | Calendar read + task write (google \| macos \| windows) |
| `contactPolicy.js` | Per-contact rules + pending approval CRUD |
| `google.js` / `googleOauth.js` | Google Calendar/Tasks API + OAuth tokens |

### LLM provider contract

- **Unified shape:** `llmChat({ messages, tools })` → `{ message: { content, tool_calls? } }` (Ollama-style)
- Agent loop must **not** branch on provider. Vendor quirks stay in `llmProvider.js`:
  - **Ollama:** pass-through to local client (`localhost:11434`)
  - **Gemini:** `systemInstruction` on `getGenerativeModel()` (not raw string-only via `startChat` — avoids 400 on `system_instruction`); history as `contents` with `functionCall` / `functionResponse`
  - **Claude:** top-level `system`; `tool_use` / `tool_result` with paired ids
  - **OpenAI / Grok:** assistant `tool_calls` + `tool` messages with `tool_call_id` (Grok default base `https://api.x.ai/v1`)
- Config: Prisma `LLMConfig` (`provider`, `modelName`, `apiKey`, `baseUrl`); short cache TTL (~10s); keys masked on GET
- Use real vendor model ids. Failures log/surface to UI — no invented cross-provider fallback unless configured

### Prisma models (`apps/core-engine/prisma/schema.prisma`)

SQLite file `apps/core-engine/prisma/data.db` (gitignored). Models: `Config`, `ConversationLog`, `LLMConfig`, `CalendarConfig`, `ContactPolicy`, `PendingApproval`.

### Engine API surface (`:3001`)

- `GET/POST /api/state` — bot on/off + custom context
- `POST /api/logout` — WA logout + re-init for new QR
- `GET/POST /api/logs` — conversation logs
- `GET/POST /api/llm-config`, `GET/POST /api/calendar-config`
- `GET /api/calendar/google-auth/init|callback` — OAuth redirect `http://localhost:3001/api/calendar/google-auth/callback`
- `GET/POST/DELETE /api/contact-policies`
- `GET /api/approvals`, `POST .../approve|reject`
- `GET /api/debug`, `GET /api/screenshot`
- Socket.IO `state` events for live UI

### WhatsApp session lifecycle

Session: `apps/core-engine/.wwebjs_auth/` (gitignored). Hard stops leave Chromium locking `userDataDir` → “browser is already running”.

Engine behavior to preserve when touching init/shutdown:

- Absolute `LocalAuth` path; Puppeteer `handleSIGINT/SIGTERM/SIGHUP: false` so the app owns shutdown
- Signals → `client.destroy()`, Prisma disconnect, HTTP close
- Before `initialize()`: kill only processes bound to this session path; remove `Singleton*` / `DevToolsActivePort`
- One automatic retry on “browser already running”
- Prefer `npm run stop` or Ctrl+C over `kill -9`; do not delete the whole auth folder unless the user wants to re-pair QR

### Web control center

App Router: `app/page.js` (dashboard), `app/settings/page.js` (LLM/calendar/policies), `app/layout.js`, `app/components/`. No separate API routes — all data from core-engine.

## Commands

Run from **repository root**. Workspaces: `apps/core-engine`, `apps/web-control-center`.

| Task | Command |
| :--- | :--- |
| Install | `npm install` (core-engine `postinstall` → `prisma generate`) |
| Prisma client | `npm run prisma:generate` |
| Apply schema (SQLite) | `npm run db:push` |
| Both apps | `npm run dev` |
| Engine only | `npm run dev:engine` → `node --watch-path=src src/server.js` |
| Web only | `npm run dev:web` → `next dev -p 3000` |
| Stop | `npm run stop` — SIGTERM then kill ports 3000/3001 + session Chromium |
| Restart | `npm run restart` |
| Local Ollama model | `ollama pull <model>` e.g. `ollama pull gemma4:latest` |

`npm run setup:auth` is defined in root `package.json` but **`apps/core-engine/src/scripts/setup_auth.js` is missing** — do not rely on it until restored.

There is **no** root (or workspace) `lint`, `test`, `build`, or single-test script. Do not assume them unless added to `package.json`.

After wiped `node_modules`, if the engine crashes with `@prisma/client did not initialize yet`, run `npm run prisma:generate`.

## Agent working rules

1. Prefer root scripts (`npm run dev:engine`, `npm run prisma:generate`, etc.) over ad-hoc paths into workspaces.
2. Keep approval and policy checks on the **send path** in core-engine — UI-only changes are not enough.
3. Keep `ollamaAgent.js` provider-agnostic; fix vendor API issues only in `llmProvider.js`.
4. For WA restart issues, fix lifecycle/locks in `server.js`; do not wipe `.wwebjs_auth` unless re-pairing is requested.
5. Do not commit runtime artifacts: `.next`, `node_modules`, `.wwebjs_auth`, `*.db`, `.env*`, `credentials.json`, `token.json`.
6. Google OAuth secrets: `apps/core-engine/credentials.json` + `token.json`, or `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
7. Chrome path: Puppeteer uses `PUPPETEER_EXECUTABLE_PATH` or macOS `/Applications/Google Chrome.app/...` when present.

## Critical files

| Path | Why |
| :--- | :--- |
| `apps/core-engine/src/server.js` | WA lifecycle, routes, Socket.IO, shutdown |
| `apps/core-engine/prisma/schema.prisma` | Data model |
| `apps/core-engine/src/services/llmProvider.js` | Provider adapters |
| `apps/core-engine/src/services/ollamaAgent.js` | Message/agent loop |
| `apps/core-engine/src/services/contactPolicy.js` | Policies + approvals |
| `apps/core-engine/src/services/calendarProvider.js` | Calendar/tasks backends |
| `apps/web-control-center/app/page.js` | Dashboard |
| `apps/web-control-center/app/settings/page.js` | Operator settings |
| `package.json` | Workspace scripts |
| `README.md` | Human setup |
| `project summary.md` | Architecture / flow reference |
| `CLAUDE.md` | Claude Code entrypoint; defers here for architecture/commands |

## Related docs

- This file (`AGENTS.md`) — **single source of truth** for architecture and dev commands (agents)
- `README.md` — human setup, LLM provider table, Google OAuth steps
- `project summary.md` — domain model and operational flow detail
- `CLAUDE.md` — thin Claude Code pointer; do not duplicate architecture here
