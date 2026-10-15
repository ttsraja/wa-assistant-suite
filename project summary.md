# WhatsApp AI Assistant Suite — Project Summary

Technical overview of the current codebase. The suite receives WhatsApp messages, applies contact policies, generates LLM drafts (multi-provider), optionally queues them for human approval, and can use calendar/task tools for context-aware replies.

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
| `services/ollamaAgent.js` | Incoming message pipeline, tools, reply dispatch (**provider-agnostic**) |
| `services/llmProvider.js` | Unified `llmChat` over Ollama / Gemini / Claude / OpenAI / Grok; **vendor adapters** map messages/tools to each API |
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
4. **Decide** — `ollamaAgent` calls `llmChat` with Ollama-style `messages`/`tools`; `llmProvider` routes to the configured vendor and normalizes the reply (including multi-turn tool calls). Tools may read calendar or create tasks/notes.
5. **Approve (optional)** — Draft lands in `PendingApproval`; owner approves/edits/rejects in the UI.
6. **Respond** — Engine sends via the WhatsApp client and writes a conversation log.
7. **Observe** — Dashboard streams `botState` and exposes logs/settings APIs.

## LLM provider layer

`llmProvider.js` is the single switch-point when Settings change provider/model/key.

| Concern | Behavior |
| :--- | :--- |
| **Unified contract** | In: `{ messages, tools }`. Out: `{ message: { content, tool_calls? } }` (same shape the agent already used for Ollama). |
| **Config** | Prisma `LLMConfig` (`provider`, `modelName`, `apiKey`, `baseUrl`); short in-memory cache; keys masked on GET. |
| **Ollama** | Local client pass-through (`http://localhost:11434`). |
| **Gemini** | `@google/generative-ai`. `systemInstruction` set on `getGenerativeModel()` so it is formatted as `Content` (avoids 400 `Invalid value at 'system_instruction'` if a raw string is only passed via `startChat`). Chat history sent as `contents`; tool turns use `functionCall` / `functionResponse`. |
| **Claude** | Anthropic Messages API: top-level `system`, tools as `tool_use` / `tool_result` with paired ids. |
| **OpenAI / Grok** | Chat Completions-compatible: assistant `tool_calls` + tool messages with matching `tool_call_id`. Grok defaults to `https://api.x.ai/v1`. |
| **Failures** | Logged and surfaced; no automatic cross-provider fallback unless configured. |

Example model ids: Ollama `gemma4:latest`; Gemini `gemini-2.0-flash` / `gemini-1.5-flash`; Claude/OpenAI/Grok per vendor catalog. Invalid model names fail at the vendor API after the request body is otherwise valid.

## WhatsApp process lifecycle

Problem addressed: stopping/restarting the engine left Chromium holding `.wwebjs_auth/session`, causing:

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
| **LLM** | Ollama (local default), Gemini, Claude, OpenAI, Grok — keys in DB, masked in API responses; vendor translation in `llmProvider.js` |
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
- `apps/core-engine/src/services/llmProvider.js` — multi-provider LLM adapters
- `apps/core-engine/src/services/ollamaAgent.js` — message/agent loop
- `apps/core-engine/src/services/*` — other domain services
- `apps/web-control-center/app/settings/page.js` — operator configuration UI
- `package.json` — workspace scripts
- `.gitignore` — sessions, secrets, DB, build artifacts excluded from git

### Docs

- `AGENTS.md` — **single source of truth** for agent-oriented architecture and commands
- `README.md` — human setup and configuration
- `project summary.md` (this file) — technical overview; keep aligned with code and `AGENTS.md`
- `CLAUDE.md` — Claude Code pointer only; defers to `AGENTS.md`
