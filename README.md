# WhatsApp AI Assistant Suite

Autonomous WhatsApp assistant with a live control dashboard. Incoming messages are evaluated against contact policies, answered by a configurable LLM, optionally held for human approval, and enriched with calendar/task context.

## Features

- **Live WhatsApp connection** via `whatsapp-web.js` + Puppeteer/Chrome, with Socket.IO status streaming to the UI
- **Multi-provider LLM** — Ollama, Gemini, Claude, OpenAI, Grok (configured in Settings)
- **Custom context injection** — e.g. “Busy at work” / meeting notes injected into prompts
- **Contact policies** — per-contact tone, information level, restricted topics, require-approval
- **Approval queue** — human-in-the-loop review/edit before sending sensitive replies
- **Calendar & tasks** — Google (OAuth), macOS Calendar/Reminders, Windows/Outlook
- **Persistent config & logs** — local SQLite via Prisma (`apps/core-engine/prisma/`)

## Architecture

npm **workspaces** monorepo:

| Path | Role |
| :--- | :--- |
| `apps/core-engine` | Backend on **:3001** — WhatsApp client, REST/Socket.IO API, LLM/calendar/policy orchestration, Prisma/SQLite |
| `apps/web-control-center` | Next.js dashboard on **:3000** — live state, logs, settings, approvals |
| `packages/` | Shared utilities (as needed) |

**Core engine services** (`apps/core-engine/src/services/`):

- `ollamaAgent.js` — message handling / tool loop
- `llmProvider.js` — multi-provider chat abstraction
- `calendarProvider.js` — calendar/tasks backends
- `contactPolicy.js` — policies + approval queue
- `google.js` / `googleOauth.js` — Google Calendar/Tasks + OAuth

## Prerequisites

- Node.js (LTS)
- npm
- Google Chrome (used by Puppeteer for WhatsApp Web)
- Optional: [Ollama](https://ollama.com) if using a local model (`ollama pull gemma4:latest`)
- Optional: Google Cloud OAuth client if using Google Calendar/Tasks

## Setup

```bash
# From repo root
npm install

# Generate Prisma client (also runs via core-engine postinstall)
npm run prisma:generate

# Push schema to local SQLite (creates/updates apps/core-engine/prisma/data.db)
npm run db:push
```

After wiping `node_modules`, always run `npm install` (postinstall generates Prisma) or `npm run prisma:generate` before starting the engine. Otherwise you may see:

`@prisma/client did not initialize yet. Please run "prisma generate"`.

## Run

**Recommended (both apps):**

```bash
npm run dev
```

**Separately:**

```bash
npm run dev:engine   # http://localhost:3001
npm run dev:web      # http://localhost:3000
```

**Stop / restart** (graceful SIGTERM first, then force-kill ports; also clears leftover WA session browser processes):

```bash
npm run stop
npm run restart
```

Open the dashboard at `http://localhost:3000`. Scan the QR code if WhatsApp shows `SCAN_QR`.

### WhatsApp session lifecycle

Session data lives in `apps/core-engine/.wwebjs_auth/` (gitignored).

On stop/restart the engine:

1. Handles `SIGINT` / `SIGTERM` and calls `client.destroy()` so Chromium releases the profile lock
2. Before init, clears stale Chromium locks (`SingletonLock`, etc.) and kills only processes bound to that session `userDataDir`
3. Retries once if it still sees “browser is already running”

Prefer `npm run stop` / Ctrl+C over raw `kill -9` so the browser can shut down cleanly. Hard kills are recovered on next start via lock cleanup.

## Configuration

### LLM

In **Settings → LLM**, choose provider, model, and API key/base URL. Values are stored in SQLite (`LLMConfig`), not committed to git.

| Provider | Typical model examples | Notes |
| :--- | :--- | :--- |
| `ollama` | `gemma4:latest`, other local tags | Default; no API key; requires Ollama running on `localhost:11434` |
| `gemini` | `gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-1.5-pro` | Google AI Studio / Generative Language API key; use a **real** Gemini model id |
| `claude` | `claude-3-5-haiku-20241022`, `claude-sonnet-4-…` | Anthropic API key |
| `openai` | `gpt-4o-mini`, `gpt-4o` | OpenAI API key; optional custom `baseUrl` |
| `grok` | xAI chat models | xAI API key; default base URL `https://api.x.ai/v1` |

**How providers plug in:** `ollamaAgent.js` always speaks a unified Ollama-style chat shape (`messages` + optional `tools` → `{ message: { content, tool_calls } }`). `llmProvider.js` is the only place that translates that into each vendor’s wire format (Gemini `systemInstruction` + `contents` / `functionCall`+`functionResponse`, Claude `system` + `tool_use`/`tool_result`, OpenAI/Grok `tool_calls` + `tool_call_id`). Switching providers in Settings should not require agent-loop changes.

After changing provider/model/key, the engine re-reads `LLMConfig` within a short cache TTL (or restart if you want an immediate clean slate).

### Google Calendar / Tasks OAuth

1. Create a Google OAuth **Web application** client
2. Authorized redirect URI:

```
http://localhost:3001/api/calendar/google-auth/callback
```

3. Either place the client JSON at `apps/core-engine/credentials.json`, **or** set:

```bash
export GOOGLE_OAUTH_CLIENT_ID=...
export GOOGLE_OAUTH_CLIENT_SECRET=...
```

4. Restart the engine → Settings → **Re-authenticate Google**

`credentials.json` and `token.json` are local-only and gitignored.

### Contact policies & approvals

Configure per-contact rules and review the approval queue in the web control center. Approvals are enforced by `core-engine` before outbound WhatsApp sends.

## Useful scripts (repo root)

| Script | Description |
| :--- | :--- |
| `npm run dev` | Engine + web together |
| `npm run dev:engine` / `dev:web` | Run one app |
| `npm run stop` | Stop ports 3000/3001 and WA session browsers |
| `npm run restart` | `stop` → brief wait → `dev` |
| `npm run db:push` | Prisma schema → SQLite |
| `npm run prisma:generate` | Regenerate `@prisma/client` |
| `npm run setup:auth` | **Broken today** — points at missing `apps/core-engine/src/scripts/setup_auth.js` |

## What is not committed

See `.gitignore`. Notably excluded:

- `node_modules/`, `.next/`, caches
- `.wwebjs_auth/`, `.wwebjs_cache/` (WhatsApp session)
- `*.db` / Prisma `data.db` (local runtime DB)
- `.env*`, `credentials.json`, `token.json`
- OS/editor junk, agent scratch (`.claude/`, `memory/`)

Keep only source, Prisma **schema**, manifests, and docs in git.

## Documentation

- `AGENTS.md` — **single source of truth** for architecture, message flow, and development commands (coding agents / Warp)
- [Project summary](./project%20summary.md) — technical overview (domain model, API surface, integrations)
- `CLAUDE.md` — Claude Code entrypoint; defers to `AGENTS.md` (do not duplicate architecture there)
- This README — human setup and operator configuration

## Ports

| Service | Port |
| :--- | :--- |
| Web control center | `3000` |
| Core engine API / Socket.IO | `3001` |
