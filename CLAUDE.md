# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

**`AGENTS.md` is the single source of truth** for architecture, message flow, LLM contract, Prisma, APIs, WhatsApp lifecycle (including re-pair), desktop/Electron notes, commands, and critical files.

Do not duplicate that content here. When the product changes, update **`AGENTS.md` only**.

Also useful:

- `README.md` — human setup, LLM table, OAuth, desktop run
- `project summary.md` — technical flow / API overview

## Claude Code notes

- Prefer root scripts (`npm run dev`, `dev:engine`, `dev:desktop:fast`, `prisma:generate`, `build:ui`).
- Keep `ollamaAgent.js` provider-agnostic; vendor fixes only in `llmProvider.js`.
- Approval/policy enforcement stays on the core-engine send path.
- Desktop dev must use stock Electron via `run-dev.mjs` — do not rename/copy `Electron.app` (breaks ICU/GPU).
- Unlink/re-pair must clear LocalAuth; UI `READY` only means truly linked.
- No root `lint` / `test` unless added to `package.json`.
- `npm run setup:auth` target script is missing — ignore until restored.
