# Pre-push validation test matrix

Source of truth for cases agents and humans run before shipping fixes/enhancements.

**Unit test detail (T1 edge cases):** [`UNIT_TESTS.md`](./UNIT_TESTS.md).

## Tiers

| Tier | Command | What | Required when |
| :--- | :--- | :--- | :--- |
| **T0** Smoke | `npm run test:smoke` | Engine boots on temp `dataDir`; `GET /api/state`, `/api/system` | **Every change** |
| **T1** Unit | `npm run test:unit` | Pure helpers (paths, policy, badge, apiBase, fingerprints) | Touched modules |
| **T2** API | `npm run test:api` | Engine HTTP with `initWhatsApp: false`, temp SQLite | Engine/API/settings |
| **T3** UI | `npm run test:ui` | Source contracts + optional static `out/` | UI / desktop-facing |
| **T4** Desktop | manual / future | Electron boot, userData isolation | Desktop/packaging |
| **T5** Live | manual checklist | Real WA QR, Google OAuth, macOS Calendar permissions | Those areas only |

Default automated gate: `npm test` → **T1 + T2**. Prefer `npm run test:all` (T1–T3) when UI changed. Always run **T0** before push.

**Isolation rule:** automated tests use temp `WA_ASSISTANT_DATA_DIR` only. Never touch real Electron `userData`, live LocalAuth, or production `token.json`.

## Agent pre-push gate

1. Map the diff to domains **A–K** below.
2. Run **T0 always** + automated tiers covering those domains.
3. For T5-only cases: run manual steps or mark **N/A** with reason.
4. If `apps/web-control-center` changed and desktop is used: `npm run build:ui`.
5. Confirm no secrets/db/session/`out/` staged; bump `version.json` only intentionally.
6. Paste a **Validation report** in PR/commit:

```text
Validation: T0 pass | T1 pass | T2 pass | T3 pass/skip
Cases: A1-A4,B3-B12,H1-H3,K1 …
Skipped T5: no WA lifecycle change
```

## Case catalog

Each ID: **tier**, short expected result.

### A. Paths, data, versioning

| ID | Tier | Expected |
| :--- | :--- | :--- |
| A1 | T1 | Default dir → `prisma/data.db` under package |
| A2 | T1 | Custom dataDir → `{dir}/data.db`, `.wwebjs_auth`, credentials/token |
| A3 | T1 | `DATABASE_URL` matches sqlite file URL |
| A4 | T1 | ensure dirs does not wipe existing DB file |
| A5 | T2 | First-run schema push; second start keeps rows |
| A6 | T1/T2 | upgrade meta does not wipe data; `/api/system` durability |
| A7 | T1 | Chrome path prefers `PUPPETEER_EXECUTABLE_PATH` |
| A8 | T1 | Lock cleanup safe if session missing |

### B. Engine lifecycle & HTTP

| ID | Tier | Expected |
| :--- | :--- | :--- |
| B1 | T2 | Second `startEngine` idempotent |
| B2 | T2 | stop + restart on same port works |
| B3 | T0/T2 | `/api/state` JSON with `connectionStatus` |
| B4 | T2 | POST status + customContext |
| B5 | T2 | logs require fields; list works |
| B6 | T2 | apiKey masked; `••••••••` not written |
| B7 | T2 | authStatus google/macos/windows present |
| B8 | T2 | calendar + tasks providers independent |
| B9 | T2 | contact policy CRUD + encoded delete |
| B10 | T2 | approvals list; bad id errors |
| B11 | T2 | system + debug paths under temp dir |
| B12 | T2 | static UI `/` and `/settings/` |
| B13 | T4 | same-origin desktop (manual/smoke) |

### C. WhatsApp connection

| ID | Tier | Expected |
| :--- | :--- | :--- |
| C1 | T1/T3 | Connected only when `READY` |
| C2 | T5 | Re-pair clears LocalAuth + fresh QR |
| C3 | T5 | Ignore stale auth until QR path |
| C4 | T5/code | Watchdog stop safe (no recursion) |
| C5 | T5 | loading_screen does not clear QR |
| C6 | T5 | Filter groups/status/self/empty/pre-start |
| C7–C8 | T5 | Lock cleanup / no orphan Chromium |

### D. Agent loop & tools

| ID | Tier | Expected |
| :--- | :--- | :--- |
| D1–D4 | T5 | pause / reply / media / `/reset` |
| D5–D6 | T5/code | tool caps + strip note tool |
| D7 | T1 | note fingerprint stable |
| D8–D12 | T5 | fallbacks, business skip, prompt contracts |

### E. Policies & approvals

| ID | Tier | Expected |
| :--- | :--- | :--- |
| E1–E5 | T1 | overlay + topic match pure fns |
| E6–E10 | T5/T2 | approval path on engine; CRUD via API |

### F. LLM providers

| ID | Tier | Expected |
| :--- | :--- | :--- |
| F1–F5 | T5/future | adapter fixtures + mocks |
| F6 | T2 | masked key does not blank secret |

### G. Calendar & tasks

| ID | Tier | Expected |
| :--- | :--- | :--- |
| G1–G3 | T5 | provider routing |
| G4–G6 | T2 | authStatus platform correctness |
| G7–G8 | T5 | privacy + script escaping |

### H. Control center UI

| ID | Tier | Expected |
| :--- | :--- | :--- |
| H1–H2 | T1 | badge uses **selected** provider |
| H3 | T3 | label `Calendar:` not `Cal:` |
| H4–H6 | T3/T2 | settings statuses + save re-fetch |
| H7–H10 | T5 | tabs / theme manual |
| H11 | T1 | apiBase priority |
| H12 | T2/T3 | static routes |
| H13–H14 | T5 | sockets + banner |

### I. Desktop

| ID | Tier | Expected |
| :--- | :--- | :--- |
| I1/K5 | T3 | stock Electron launcher only |
| I2–I7 | T4/T5 | userData, quit, chrome, externals |
| I8 | future | packaged resources |

### J. Security / hygiene

| ID | Tier | Expected |
| :--- | :--- | :--- |
| J1 | T2 | no raw apiKey |
| J2 | manual | gitignore secrets/db/out |
| J3–J4 | T5/T2 | OAuth redirects; bad approval id |

### K. Regression pack

| ID | Tier | Bug |
| :--- | :--- | :--- |
| K1 | T1 | Calendar badge always Google |
| K2 | code | stopReadyWatchdog recursion |
| K3 | T1/T5 | false authenticated / QR gone |
| K4 | T5 | loading_screen clears QR |
| K5 | T3 | renamed Electron.app breaks ICU |
| K6 | T1 | note multi-write loops |

## Layout

```text
tests/
  helpers/engineHarness.js
  smoke/t0-engine-smoke.mjs
  unit/*.test.js
  api/*.test.js
  ui/*.test.js
docs/TEST_MATRIX.md
docs/UNIT_TESTS.md
```

## Out of scope (v1)

- Live multi-provider LLM spend tests
- Signed DMG E2E
- Real phone QR automation
