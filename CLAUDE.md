# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

**`AGENTS.md` is the single source of truth** for architecture, message flow, LLM contract, Prisma, APIs, WhatsApp lifecycle (including re-pair), desktop/Electron notes, commands, and critical files.

Do not duplicate that content here. When the product changes, update **`AGENTS.md` only**.

Also useful:

- `README.md` — human setup, LLM table, Master Agent tone, OAuth, desktop run
- `docs/TEST_MATRIX.md` / `docs/UNIT_TESTS.md` — validation gate and unit inventory
- `project summary.md` — technical flow / API overview

## Claude Code notes

- Prefer root scripts (`npm run dev`, `dev:engine`, `dev:desktop:fast`, `prisma:generate`, `db:push`, `build:ui`, `test`, `test:unit`, `test:all`).
- Keep `ollamaAgent.js` provider-agnostic; vendor fixes only in `llmProvider.js`.
- Global **response tone** lives in `responseTone.js` + `Config.responseTone` and is system-prompt text only (all LLM vendors). Contact policy tone overrides when non-`auto`.
- **Prisma:** schema in `apps/core-engine/prisma/schema.prisma`. Browser DB ≠ desktop `userData` DB. Engine `ensureDatabaseSchema()` auto additive-upgrades the active data dir (missing columns/tables) without wiping data. After schema edits: `prisma:generate` + `db:push`, then restart desktop so userData upgrades. Cover changes with `tests/unit/prismaSchema.test.js`.
- Approval/policy enforcement stays on the core-engine send path.
- Desktop dev must use stock Electron via `run-dev.mjs` — do not rename/copy `Electron.app` (breaks ICU/GPU).
- Unlink/re-pair must clear LocalAuth; UI `READY` only means truly linked.
- Before push: `npm run test:smoke` and `npm test` (see AGENTS validation gate + `docs/TEST_MATRIX.md` / `docs/UNIT_TESTS.md`).
- `npm run setup:auth` target script is missing — ignore until restored.
