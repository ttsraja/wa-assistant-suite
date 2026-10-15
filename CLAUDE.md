# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

**`AGENTS.md` is the single source of truth** for project architecture, message flow, LLM provider contract, Prisma models, API surface, WhatsApp session lifecycle, development commands, agent working rules, and critical files.

Do not duplicate or diverge from that content here. When architecture or scripts change, update `AGENTS.md` only (and keep this pointer accurate).

Also useful:

- `README.md` — human setup, LLM provider table, Google OAuth
- `project summary.md` — domain model and operational flow detail

## Claude Code notes

- Prefer root scripts from `AGENTS.md` (`npm run dev`, `dev:engine`, `prisma:generate`, etc.) over ad-hoc workspace paths.
- Keep `ollamaAgent.js` provider-agnostic; vendor wire-format fixes belong only in `llmProvider.js`.
- Approval/policy enforcement must stay on the core-engine send path — UI-only changes are insufficient.
- There is no root `lint` / `test` / `build` script unless added to `package.json`.
- `npm run setup:auth` is wired in root `package.json` but the target script file is missing — ignore it until restored.
