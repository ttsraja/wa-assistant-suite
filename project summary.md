# WhatsApp AI Assistant Suite — Project Summary

Technical overview of the current codebase (v2 branch). The suite receives WhatsApp messages, applies contact policies, generates LLM drafts (multi-provider), optionally queues them for human approval, and can use calendar/task tools for context-aware replies.

## Architecture

npm workspaces monorepo with two runtime apps:

### 1. Core Engine — `apps/core-engine`

- **HTTP + Socket.IO** on port **3001**
- **WhatsApp** via `whatsapp-web.js` + Puppeteer (system Chrome when available)
- **Prisma + SQLite** for config, logs, policies, approvals (`prisma/schema.prisma`, local `data.db`)
- **Orchestration** of LLM, calendar/tasks, contact policy, and outbound sends

Key entrypoint: `src/server.js`

Key services:

| Module | Responsibility |
| :--- | :--- |
| `services/ollamaAgent.js` | Incoming message pipeline, tools, reply dispatch |
| `services/llmProvider.js` | Unified chat API over Ollama / Gemini / Claude / OpenAI / Grok |
| `services/calendarProvider.js` | Calendar read + task write (Google / macOS / Windows) |
| `services/contactPolicy.js` | Per-contact rules + pending approval CRUD |
| `services/google.js` | Google Calendar/Tasks API calls |
| `services/googleOauth.js` | OAuth URL + callback + token persistence |

### 2. Web Control Center — `apps/web-control-center`

- Next.js UI on port **3000**
- Live bot state (connection, QR, user) over Socket.IO / REST
- Settings for LLM, calendar, contact policies
- Conversation logs and approval queue

Primary UI paths: `app/page.js`, `app/settings/page.js`

### 3. Shared / tooling

- Root `package.json` scripts coordinate both apps (`dev`, `stop`, `restart`, `db:push`, `prisma:generate`)
- `packages/` reserved for shared non-UI logic as the suite grows

## Domain model (Prisma)

| Model | Purpose |
| :--- | :--- |
| `Config` | Global bot on/off + custom context string |
| `ConversationLog` | Audited message/response history |
| `LLMConfig` | Provider, model, API key, optional base URL |
| `CalendarConfig` | Calendar + tasks backend selection |
| `ContactPolicy` | Tone, info level, restricted topics, require-approval, custom instructions |
| `PendingApproval` | Human review queue (pending / approved / rejected / sent) |

Runtime DB file is local-only and gitignored. Schema is source-controlled; use `npm run db:push` after schema changes and `npm run prisma:generate` after installs.

## Operational flow

1. **Connect** — Engine initializes WhatsApp Web (clears stale Chromium session locks first). UI shows QR or READY.
2. **Receive** — `message_create` filters groups/status/self; forwards DMs to the agent.
3. **Govern** — Contact policy applies tone/info limits; may force approval instead of auto-send.
4. **Decide** — LLM provider generates a draft; tools may read calendar or create tasks/notes.
5. **Approve (optional)** — Draft lands in `PendingApproval`; owner approves/edits/rejects in the UI.
6. **Respond** — Engine sends via the WhatsApp client and writes a conversation log.
7. **Observe** — Dashboard streams `botState` and exposes logs/settings APIs.

## WhatsApp process lifecycle

Problem addressed in v2: stopping/restarting the engine left Chromium holding `.wwebjs_auth/session`, causing:

> The browser is already running for …/session. Use a different `userDataDir` or stop the running browser first.

Current behavior:

- Absolute `LocalAuth` path under `apps/core-engine/.wwebjs_auth`
- Puppeteer `handleSIGINT/SIGTERM/SIGHUP: false` so the app owns shutdown
- On `SIGINT`/`SIGTERM`/`SIGHUP`: `client.destroy()`, Prisma disconnect, HTTP close
- Before `initialize()`: kill only processes tied to this session dir; remove `SingletonLock` / `SingletonSocket` / `SingletonCookie` / `DevToolsActivePort`
- One automatic retry if init still reports an in-use `userDataDir`
- Root `npm run stop` sends SIGTERM first, then force-kills ports 3000/3001 and session-bound browsers

## Integrations

| Integration | Notes |
| :--- | :--- |
| **LLM** | Ollama (local default), Gemini, Claude, OpenAI, Grok — keys in DB, masked in API responses |
| **Google Calendar/Tasks** | OAuth web client; redirect `http://localhost:3001/api/calendar/google-auth/callback`; `credentials.json` / `token.json` gitignored |
| **macOS** | Calendar + Reminders via AppleScript when selected |
| **Windows** | Outlook calendar/tasks via PowerShell when selected |

## API surface (engine)

Representative routes (all on `:3001`):

- `GET/POST /api/state` — bot status + custom context
- `POST /api/logout` — WhatsApp logout + re-init for new QR
- `GET/POST /api/logs` — conversation log read/write
- `GET/POST /api/llm-config` — LLM settings
- `GET/POST /api/calendar-config` — calendar/tasks settings
- `GET /api/calendar/google-auth/init|callback` — Google OAuth
- `GET/POST/DELETE /api/contact-policies` — policy CRUD
- `GET /api/approvals`, `POST .../approve|reject` — approval queue
- `GET /api/debug`, `GET /api/screenshot` — diagnostics
- Socket.IO `state` events for live UI updates

## Dev commands (root)

```bash
npm install
npm run prisma:generate
npm run db:push
npm run dev          # engine + web
npm run stop         # clean shutdown helpers
npm run restart
```

## Source of truth files

- `apps/core-engine/src/server.js` — WA client lifecycle, HTTP, Socket.IO
- `apps/core-engine/prisma/schema.prisma` — data model
- `apps/core-engine/src/services/*` — domain services
- `apps/web-control-center/app/settings/page.js` — operator configuration UI
- `package.json` — workspace scripts
- `.gitignore` — sessions, secrets, DB, build artifacts excluded from git
