# WA Assistant Suite

### Your WhatsApp. Your AI. Your rules.

**WA Assistant Suite** is a private, multi-provider AI assistant that lives next to WhatsApp Web — auto-replies with calendar awareness, contact policies, optional human approval, and a native macOS / Windows desktop app.

<p align="center">
  <a href="https://github.com/ttsraja/wa-assistant-suite/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/ttsraja/wa-assistant-suite?style=for-the-badge&label=Release&color=1c1c1e"></a>
  <a href="#download-desktop-app"><img alt="macOS" src="https://img.shields.io/badge/macOS-DMG%20%2F%20ZIP-000000?style=for-the-badge&logo=apple&logoColor=white"></a>
  <a href="#download-desktop-app"><img alt="Windows" src="https://img.shields.io/badge/Windows-NSIS%20%2F%20Portable-0078D4?style=for-the-badge&logo=windows&logoColor=white"></a>
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge"></a>
  <a href="#run-from-source-developers"><img alt="Node" src="https://img.shields.io/badge/Node.js-LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"></a>
</p>

<p align="center">
  <strong><a href="#download-desktop-app">Download the app</a></strong>
  &nbsp;·&nbsp;
  <strong><a href="#run-from-source-developers">Clone &amp; run from source</a></strong>
  &nbsp;·&nbsp;
  <strong><a href="https://github.com/ttsraja/wa-assistant-suite/releases">All releases</a></strong>
</p>

---

## Why people try it

| | |
| :--- | :--- |
| **Stay in control** | Pause auto-reply anytime. Require approval for sensitive contacts. |
| **Your model, your cloud or local** | Ollama on your machine, or Gemini / Claude / OpenAI / Grok. |
| **Sounds like you** | Global response tone + per-contact tone (formal, casual, Tamil, Tanglish, and more). |
| **Actually useful tools** | Check free/busy; log meeting requests and notes to Calendar / Tasks / Reminders. |
| **Desktop-first privacy** | Session, SQLite DB, and OAuth tokens stay on **your** disk — not our servers. |
| **Upgrade-safe** | App updates do not wipe WhatsApp link, policies, or history. |

> Think of it as an executive assistant that never sleeps on WhatsApp — with a control room you own.

---

## Choose how to get started

| Path | Best for | Time |
| :--- | :--- | :--- |
| **[Desktop app](#download-desktop-app)** | Try the product as a standalone Mac/Windows app | ~5 minutes |
| **[From source](#run-from-source-developers)** | Develop, customize, or run the full monorepo | ~10–15 minutes |

---

## Download desktop app

Prebuilt installers are published on **GitHub Releases**. Prefer the **[latest release](https://github.com/ttsraja/wa-assistant-suite/releases/latest)**.

### macOS (Apple Silicon)

| File | Release asset name | Link |
| :--- | :--- | :--- |
| **DMG installer** (recommended) | `WA.Assistant.Suite-1.0.0-arm64.dmg` | [Download macOS DMG](https://github.com/ttsraja/wa-assistant-suite/releases/latest/download/WA.Assistant.Suite-1.0.0-arm64.dmg) |
| **ZIP** (drag to Applications) | `WA.Assistant.Suite-1.0.0-arm64-mac.zip` | [Download macOS ZIP](https://github.com/ttsraja/wa-assistant-suite/releases/latest/download/WA.Assistant.Suite-1.0.0-arm64-mac.zip) |

**Install**

1. Open the DMG (or unzip) and drag **WA Assistant Suite** to **Applications**.
2. First launch: if Gatekeeper blocks an unsigned build, right-click → **Open** → confirm (or allow under *System Settings → Privacy & Security*).
3. Link WhatsApp: phone → **Settings → Linked devices → Link a device** → scan the QR in the app.
4. Pick an LLM in **Settings → LLM** (Ollama local or a cloud API key).

**Data location (macOS):**  
`~/Library/Application Support/WA Assistant Suite/`  
(DB, WhatsApp session, OAuth tokens, upgrade history)

### Windows (x64)

| File | Release asset name | Link |
| :--- | :--- | :--- |
| **NSIS installer** (recommended) | `WA.Assistant.Suite.Setup.1.0.0.exe` | [Download Windows Setup](https://github.com/ttsraja/wa-assistant-suite/releases/latest/download/WA.Assistant.Suite.Setup.1.0.0.exe) |
| **Portable** (no install) | `WA.Assistant.Suite.1.0.0.exe` | [Download Windows Portable](https://github.com/ttsraja/wa-assistant-suite/releases/latest/download/WA.Assistant.Suite.1.0.0.exe) |

**Install**

1. Run the Setup EXE (or launch the portable build).
2. Allow Windows SmartScreen if prompted for an unsigned build (*More info → Run anyway*).
3. Scan the WhatsApp QR and configure your LLM as on macOS.

**Data location (Windows):**  
`%APPDATA%\WA Assistant Suite\`

### Source code archives

Same as cloning the release tag (no installer):

| Archive | Link |
| :--- | :--- |
| **Source code (zip)** | [Download source zip](https://github.com/ttsraja/wa-assistant-suite/archive/refs/tags/v1.0.0.zip) |
| **Source code (tar.gz)** | [Download source tar.gz](https://github.com/ttsraja/wa-assistant-suite/archive/refs/tags/v1.0.0.tar.gz) |

Or open the [latest release](https://github.com/ttsraja/wa-assistant-suite/releases/latest) and use the *Source code* assets listed there.

### Requirements (desktop)

- **macOS** 12+ (Apple Silicon builds are published; Intel may require building from source)
- **Windows** 10/11 x64
- **Google Chrome** (or Edge) installed — used for WhatsApp Web automation
- Optional: [Ollama](https://ollama.com) for fully local models
- Optional: Google OAuth client for Google Calendar / Tasks

### About release packages

| Note | Detail |
| :--- | :--- |
| **Unsigned builds** | Community/dev releases may not be Apple-notarized or Windows-signed. Use the “Open anyway” path above. |
| **Exact filenames** | GitHub Release assets use dotted names (e.g. `WA.Assistant.Suite-1.0.0-arm64.dmg`). Source code archives (`Source code (zip)` / `tar.gz`) are also on the release page for cloning without git. If a link 404s, open the [Releases page](https://github.com/ttsraja/wa-assistant-suite/releases/latest). |
| **Packaging status** | Production installers still need a complete engine dependency stage for fully offline packaged runs. If a release build fails to start the engine, use **[Run from source](#run-from-source-developers)** or `npm run dev:desktop:fast` — that path is fully supported today. |
| **Publishing** | Maintainers: build with `npm run build:desktop:mac` / `build:desktop:win`, then upload artifacts from `apps/desktop/release/` to a GitHub Release tagged `v1.0.0` (or the next version). |

---

## Run from source (developers)

Full monorepo: engine + control center + optional Electron shell.

### Prerequisites

- **Node.js** (LTS) + npm
- **Google Chrome** (WhatsApp Web / Puppeteer)
- Optional: Ollama, Google Cloud OAuth credentials

### Clone & install

```bash
git clone https://github.com/ttsraja/wa-assistant-suite.git
cd wa-assistant-suite
npm install
npm run prisma:generate
npm run db:push
```

Optional env template:

```bash
cp .env.example apps/core-engine/.env   # edit as needed — never commit secrets
```

### Option A — Browser control center

```bash
npm run dev
```

| Service | URL |
| :--- | :--- |
| Dashboard | http://localhost:3000 |
| Engine API | http://localhost:3001 |

Open the dashboard → scan WhatsApp QR when status is **SCAN_QR**.

```bash
npm run stop      # free ports + session Chromium
npm run restart
```

### Option B — Desktop from source (recommended local app)

```bash
npm run build:ui              # once, or after UI changes
npm run dev:desktop:fast      # Electron + engine + static UI
# or rebuild UI then launch:
npm run dev:desktop
```

Uses stock Electron (stable GPU/ICU). Dev menu bar may still say “Electron”; product name is **WA Assistant Suite**.

**Databases are per mode:** browser dev uses `apps/core-engine/prisma/data.db`; desktop uses OS Application Support / `%APPDATA%`. Root `db:push` updates the package DB. On startup the engine **auto-applies additive schema upgrades** to the active data dir (user rows preserved).

### Build installers yourself

```bash
npm run build:desktop:mac     # → apps/desktop/release/ (DMG + ZIP, arm64)
npm run build:desktop:win     # → apps/desktop/release/ (NSIS + portable)
```

Upload artifacts from `apps/desktop/release/` to a [GitHub Release](https://github.com/ttsraja/wa-assistant-suite/releases/new).

### Tests

```bash
npm run test:smoke    # engine boots on temp data dir
npm test              # unit + API
npm run test:all      # unit + API + UI contracts
```

---

## Features at a glance

| Area | What you get |
| :--- | :--- |
| **WhatsApp** | Link via QR; READY-only connected UI; full **Unlink / Re-pair** clears session safely |
| **LLM** | Ollama · Gemini · Claude · OpenAI · Grok — one agent loop, vendor adapters isolated |
| **Master Agent** | Reply ON/OFF · **Response tone** · dynamic context (“Busy until 6”) |
| **Contacts** | Per-contact tone, info level, restricted topics, require-approval |
| **Approvals** | Review / edit draft before send |
| **Calendar & tasks** | Google OAuth, macOS Calendar/Reminders, Windows Outlook |
| **Desktop** | Native shell, graphite dark theme, upgrade-safe `userData` |
| **System** | Version, paths, durability, upgrade history |

### Master Agent response tone

Global style for every LLM provider (system-prompt based — no vendor lock-in):

`auto` · `formal` · `casual` · `friendly` · `concise` · `tamil` · `tanglish`

Per-contact policy tone still **overrides** the global default when set.

### Architecture

```text
WhatsApp DM
    → contact policy
    → LLM draft (+ optional calendar/task tools)
    → auto-send or approval queue
    → conversation log + live dashboard
```

| Path | Role |
| :--- | :--- |
| `apps/core-engine` | Backend **:3001** — WhatsApp, REST/Socket.IO, Prisma/SQLite |
| `apps/web-control-center` | Next.js UI — browser **:3000** or static export for desktop |
| `apps/desktop` | Electron shell — engine + UI, portable data |
| `version.json` | Product version / channel / productId |

Agent & contributor deep-dive: **[AGENTS.md](./AGENTS.md)**.

---

## Configuration notes

### LLM (Settings → LLM)

| Provider | Examples | Notes |
| :--- | :--- | :--- |
| `ollama` | `gemma4:latest`, `llama3.2` | Local · `localhost:11434` |
| `gemini` | `gemini-2.0-flash` | API key from Google AI Studio |
| `claude` | Anthropic model ids | API key |
| `openai` | `gpt-4o-mini`, `gpt-4o` | Optional custom `baseUrl` |
| `grok` | xAI models | Default `https://api.x.ai/v1` |

### Google Calendar / Tasks

OAuth redirect URI:

```text
http://localhost:3001/api/calendar/google-auth/callback
```

Place `credentials.json` in the **data directory** (engine root in browser mode, or desktop `userData`), or set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`. Then **Settings → Calendar → Re-authenticate Google**.

### Privacy & data

- WhatsApp session, SQLite DB, policies, logs, and OAuth tokens stay **local**
- No cloud backend is operated by this project
- You are responsible for API keys and WhatsApp account use (follow Meta’s terms)

### Ports

| Service | Port |
| :--- | :--- |
| Web (Next dev) | `3000` |
| Core engine | `3001` |

---

## Scripts (root)

| Script | Description |
| :--- | :--- |
| `npm run dev` | Engine + web |
| `npm run dev:engine` / `dev:web` | One app |
| `npm run build:ui` | Static UI → `apps/web-control-center/out` |
| `npm run dev:desktop` / `dev:desktop:fast` | Electron desktop |
| `npm run build:desktop:mac` / `win` | Package installers |
| `npm run stop` / `restart` | Ports + WA Chromium |
| `npm run db:push` / `prisma:generate` | Package SQLite / Prisma client |
| `npm test` / `test:unit` / `test:smoke` / `test:all` | Validation gate |

---

## Documentation

| Doc | Role |
| :--- | :--- |
| **[AGENTS.md](./AGENTS.md)** | Source of truth — architecture, tone, Prisma, WA lifecycle, validation gate |
| [CLAUDE.md](./CLAUDE.md) | Claude/agent entry → AGENTS |
| [docs/TEST_MATRIX.md](./docs/TEST_MATRIX.md) | Pre-push test catalog |
| [docs/UNIT_TESTS.md](./docs/UNIT_TESTS.md) | Unit edge-case inventory |
| [project summary.md](./project%20summary.md) | Technical overview |
| This README | Humans: download, run, configure |

---

## Contributing

Issues and PRs are welcome.

1. Fork → branch → keep changes focused  
2. Run `npm run test:smoke` and `npm test` before opening a PR  
3. Do not commit secrets, sessions, `*.db`, `out/`, or `release/`  
4. See **AGENTS.md** for architecture constraints (especially WA re-pair and LLM provider boundaries)

---

## Roadmap / known gaps

- [ ] Complete production pack pipeline (stage full engine `node_modules` into DMG/NSIS)
- [ ] Optional code signing & notarization (macOS) / Authenticode (Windows)
- [ ] Intel Mac / additional Windows arches as demand appears
- [ ] Restore `setup:auth` helper script

Star the repo and watch **Releases** for installer updates.

---

## Security

- Report sensitive issues privately via GitHub Security Advisories if enabled, or open a minimal issue without secrets
- Never paste WhatsApp session folders, `token.json`, or API keys into issues

---

## License

[MIT](./LICENSE) © WA Assistant Suite contributors

---

<p align="center">
  <sub>Built for people who live on WhatsApp but refuse to lose control of their time.</sub><br/>
  <a href="https://github.com/ttsraja/wa-assistant-suite/releases/latest"><strong>Download latest release</strong></a>
  ·
  <a href="https://github.com/ttsraja/wa-assistant-suite"><strong>Star on GitHub</strong></a>
</p>
