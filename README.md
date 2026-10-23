# WhatsApp AI Assistant Suite

Autonomous WhatsApp assistant with a live control dashboard and optional **desktop app** (Electron). Incoming DMs go through contact policies, a multi-provider LLM (with optional calendar/task tools), optional human approval, then send + log.

**Version:** see root `version.json` (currently **1.0.0**).

## Features

- **WhatsApp Web** via `whatsapp-web.js` + system Chrome (Puppeteer)
- **Multi-provider LLM** — Ollama, Gemini, Claude, OpenAI, Grok
- **Contact policies** — tone, info level, restricted topics, require-approval
- **Approval queue** — review/edit before send
- **Calendar & tasks** — Google OAuth, macOS Calendar/Reminders, Windows/Outlook
- **Custom context** — e.g. “Busy at work” injected into prompts
- **Desktop shell** — single-window app; data in OS Application Support (upgrade-safe)
- **System & Updates** panel — version, data paths, upgrade history

## Architecture

| Path | Role |
| :--- | :--- |
| `apps/core-engine` | Backend **:3001** — WhatsApp, REST/Socket.IO, Prisma/SQLite, orchestration |
| `apps/web-control-center` | Next.js UI — browser **:3000** or static export served by engine/desktop |
| `apps/desktop` | Electron — starts engine with portable `userData`, loads UI |
| `version.json` | Product version / channel / productId |

Docs for agents: **`AGENTS.md`** (source of truth). Claude: `CLAUDE.md` → defers to AGENTS.

## Prerequisites

- Node.js (LTS) + npm
- Google Chrome (WhatsApp Web automation)
- Optional: [Ollama](https://ollama.com) for local models
- Optional: Google Cloud OAuth client for Calendar/Tasks
- Desktop: Electron is installed via npm (`allowScripts` must allow `electron`)

## Setup

```bash
npm install
npm run prisma:generate
npm run db:push
```

After wiping `node_modules`, run `npm install` or `npm run prisma:generate` before the engine.

## Run (browser)

```bash
npm run dev                 # engine :3001 + web :3000
# or
npm run dev:engine
npm run dev:web

npm run stop                # free ports + session Chromium
npm run restart
```

Open **http://localhost:3000**. Scan QR when status is `SCAN_QR`.

### WhatsApp session

- Browser dev session: `apps/core-engine/.wwebjs_auth/` (gitignored)
- Desktop session: `~/Library/Application Support/WA Assistant Suite/.wwebjs_auth` (macOS)

**Unlink / Re-pair** destroys the client and **deletes LocalAuth** so a new QR is required (no false “authenticated” from a stale session).

Prefer `npm run stop` or Ctrl+C over `kill -9`.

## Run (desktop)

```bash
npm run build:ui            # once (or after UI changes)
npm run dev:desktop:fast    # Electron + engine + static UI
# or rebuild UI then launch:
npm run dev:desktop
```

- Data dir (macOS): `~/Library/Application Support/WA Assistant Suite/`
- Dev menu bar may still say **Electron** (stock binary). Packaged apps use **WA Assistant Suite**.
- Do not use experimental Electron.app renames — they break GPU/ICU.

Package (local/unsigned; production packaging still evolving):

```bash
npm run build:desktop:mac
npm run build:desktop:win
```

## Configuration

### LLM (Settings → LLM)

| Provider | Examples | Notes |
| :--- | :--- | :--- |
| `ollama` | `gemma4:latest` | Local; `localhost:11434` |
| `gemini` | `gemini-2.0-flash`, `gemini-1.5-flash` | Real model ids |
| `claude` | Anthropic catalog ids | API key |
| `openai` | `gpt-4o-mini`, `gpt-4o` | Optional `baseUrl` |
| `grok` | xAI models | Default `https://api.x.ai/v1` |

Unified agent shape is Ollama-style; `llmProvider.js` adapts vendors.

### Google Calendar / Tasks

Redirect URI:

```
http://localhost:3001/api/calendar/google-auth/callback
```

Place `credentials.json` in the **data directory** (core-engine root in browser dev, or desktop `userData`), or set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`. Then Settings → Re-authenticate Google.

### Policies & approvals

Configured in the control center; enforced by core-engine before WhatsApp send.

### System & Updates

Settings → **System & Updates**: version, schema, data paths, durability guarantees, upgrade history.

## Scripts (root)

| Script | Description |
| :--- | :--- |
| `npm run dev` | Engine + web |
| `npm run dev:engine` / `dev:web` | One app |
| `npm run build:ui` | Static export → `apps/web-control-center/out` |
| `npm run dev:desktop` / `dev:desktop:fast` | Electron desktop |
| `npm run build:desktop:mac` / `win` | Package desktop |
| `npm run stop` / `restart` | Ports + WA Chromium |
| `npm run db:push` / `prisma:generate` | SQLite / client |
| `npm run setup:auth` | **Broken** — missing script file |

## Not committed

`.gitignore` excludes `node_modules`, `.next`, `out/`, `.wwebjs_auth`, `*.db`, `.env*`, OAuth tokens, `apps/desktop/release/`, `apps/desktop/.runtime/`, agent scratch.

## Ports

| Service | Port |
| :--- | :--- |
| Web (Next dev) | `3000` |
| Core engine | `3001` |

## Documentation

- [`AGENTS.md`](./AGENTS.md) — architecture & commands (agents)
- [`project summary.md`](./project%20summary.md) — technical overview
- [`CLAUDE.md`](./CLAUDE.md) — Claude entrypoint → AGENTS
