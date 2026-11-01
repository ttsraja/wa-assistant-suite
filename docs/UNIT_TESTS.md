# Unit test catalog (T1)

Detailed inventory of **automated unit tests** under `tests/unit/`.  
Parent matrix: [`TEST_MATRIX.md`](./TEST_MATRIX.md). Run with `npm run test:unit`.

## Principles

- **Pure / isolated only** — no live WhatsApp, OAuth, or paid LLM calls.
- **Temp dirs** for filesystem cases; never real Electron `userData`.
- Map each test to matrix IDs (A–K) where applicable.
- Prefer exporting pure helpers (`parseToolArgs`, `noteFingerprint`, badge helpers) over mocking heavy modules.

## Files

| File | Module under test | Focus |
| :--- | :--- | :--- |
| `paths.test.js` | `apps/core-engine/src/paths.js` | data dirs, SQLite URLs, ports, Chrome, locks |
| `appMeta.test.js` | `apps/core-engine/src/appMeta.js` | version meta, upgrades, durability |
| `contactPolicy.test.js` | `contactPolicy.js` pure overlays | tone, info, topics, custom |
| `calendarAndBadge.test.js` | calendar fingerprint + UI libs | note dedupe key, badge, READY, apiBase |
| `llmHelpers.test.js` | `llmProvider.js` exports | tool args / Gemini response coercion |
| `responseTone.test.js` | `responseTone.js` + `buildSystemPrompt` | Master Agent global tone |
| `prismaSchema.test.js` | `db.js` + `schema.prisma` | first-run, additive upgrade, retry |

---

## paths.test.js (A)

| Case | Edge covered | Expected |
| :--- | :--- | :--- |
| A1 package default | default root | `prisma/data.db`, `.wwebjs_auth/session` |
| A2 custom dir | desktop-style dataDir | root `data.db`, credentials/token paths |
| A2b trim/env | whitespace env + explicit override | trimmed resolve; explicit wins |
| A2c empty env | `WA_ASSISTANT_DATA_DIR='   '` | falls back to `PACKAGE_ROOT` |
| A3 DATABASE_URL | custom dir | env URL matches `toPrismaSqliteUrl` |
| A3b unix URL | `/tmp/...` | `file:/tmp/...` |
| A3c Windows path | `C:\Users\...` | `file:C:/...` |
| A4 no wipe | existing DB bytes | content preserved after ensure |
| A4b idempotent | double ensure | no throw |
| getEnginePort explicit | number/string/`0` | finite explicit used |
| getEnginePort env | valid / invalid / negative / 0 | invalid → 3001 |
| host/origin | defaults + env | `127.0.0.1`, `localhost:3000` overridable |
| A7 Chrome env | `PUPPETEER_EXECUTABLE_PATH` | exact override |
| A7b discovery | no override | path exists or `undefined` |
| A8 missing session | nonexistent dir | no throw |
| A8b lock wipe | Singleton* files | removed |
| getPaths cache | after apply | stable snapshot |
| resolveDatabaseFile | package vs custom | prisma vs root `data.db` |

---

## appMeta.test.js (A6)

| Case | Edge covered | Expected |
| :--- | :--- | :--- |
| loadVersionManifest | repo `version.json` | version + source |
| first install | empty meta | writes `app-meta.json`; **DB/token untouched** |
| same version | relaunch | no upgrade history |
| version bump | 1.0.0 → 1.1.0 | history + pre-upgrade backup; DB/token kept |
| history cap | 25 bumps | ≤ 20 history entries |
| getSystemInfo | feed env | durability + update.supported |
| corrupt meta | invalid JSON | treated as fresh; user files kept |

---

## contactPolicy.test.js (E1–E5)

| Case | Edge covered | Expected |
| :--- | :--- | :--- |
| E1 empty | null/undefined/`{}` | empty overlay |
| E2 tones | formal/casual/tamil/tanglish/auto/unknown | only known tones inject |
| E3 infoLevel | limited/minimal/full/unknown | only limited/minimal |
| E4 bad JSON | invalid topics | empty matches, no section |
| E5 match | case, multi-topic, empty msg | substring, case-insensitive |
| E5b empty array | `[]` | no matches |
| custom blank | whitespace instructions | ignored; trim on real text |
| combined | all fields | all sections present |

---

## calendarAndBadge.test.js (D7, H, C1, H11, K1/K6)

### noteFingerprint

| Case | Edge | Expected |
| :--- | :--- | :--- |
| normalize | case/whitespace | equal fingerprints |
| identity | different sender/type | unequal |
| senderName fallback | no senderId | lowercased name |
| defaults | empty args | `unknown\|GENERAL_NOTE\|` |
| summary alias | `summary` vs `messageSummary` | equal |
| long text | 1000 chars | summary part length 400 |
| null-safe | null/undefined | no throw |

### calendar badge / providerReady

| Case | Edge | Expected |
| :--- | :--- | :--- |
| H2 macos | Google not configured | `Ready`, ok=true |
| H1 google | Authenticated vs not | `Auth OK` / `Not configured` |
| mixed | all pairs | dual short labels; ok iff both ready |
| windows | Unavailable | amber path |
| unknown status | custom string | passthrough label |
| empty auth | `{}` | `—` / Not configured |
| defaults | omitted keys | google defaults |
| native Authenticated | macos Authenticated | ready=true |
| google Available | not enough | ready=false |

### connectionStatus

| Case | Edge | Expected |
| :--- | :--- | :--- |
| connected matrix | all statuses + null/'' | only `READY` |
| loading | LOADING/AUTHENTICATED | true only those |
| needsScan | QR present/absent × status | SCAN_QR always; QR+non-ready-loading |

### resolveApiBase / normalize

| Case | Edge | Expected |
| :--- | :--- | :--- |
| preload wins | beats location+env | stripped slash base |
| same-origin flag | `__WA_SAME_ORIGIN_API__` | origin |
| port 3001 / ENGINE_PORT | match origin | same origin |
| loopback :4000 | non-3000 loopback | origin |
| example.com:3000 | non-loopback Next | fallback 3001 |
| no window | NEXT_PUBLIC_API_BASE | used; else fallback |
| normalize | empty/null | `''` |
| file: protocol | Electron file UI | fallback 3001 |

---

## llmHelpers.test.js (F)

| Case | Edge | Expected |
| :--- | :--- | :--- |
| parseToolArgs null | null/undefined | `{}` |
| object identity | object/array | same reference |
| JSON string | valid | parsed |
| bad JSON | garbage/empty | `{}` |
| number/bool | non-string | `{}` |
| toFunctionResponse object | object/array | passthrough |
| JSON object string | `{"a":1}` | unwrapped |
| JSON primitive | string/number/bool/null JSON | `{ result: ... }` |
| plain string | non-JSON | `{ result: text }` |
| nullish number | null/undefined/0 | `{ result: null\|0 }` |

---


---

## responseTone.test.js (Master Agent)

| Case | Edge | Expected |
| :--- | :--- | :--- |
| canonical list | values freeze | auto…tanglish |
| normalize | null/empty/case/unknown | auto or lowercased known |
| overlay auto | auto/unknown | empty string |
| overlay each tone | formal…tanglish | GLOBAL RESPONSE TONE + instruction |
| contact override helper | auto vs formal | false vs true |
| system prompt auto | no global block | mirror-sender language |
| system prompt formal | tools + role intact | GLOBAL block present |
| tamil language rule | tamil tone | Follow GLOBAL…language |
| policy after global | contact override text | override appears after global |
| unknown tone prompt | garbage | no GLOBAL block |


---

## prismaSchema.test.js (A5 — Prisma / SQLite)

| Case | Edge | Expected |
| :--- | :--- | :--- |
| schema.prisma lock | REQUIRED_MODELS + responseTone | all models/fields present in file |
| isSchemaDriftError | P2021/P2022/no such column vs other | true only for drift |
| first-run empty dir | no DB file | push creates all tables + Config columns |
| no-op when current | second ensure | `pushed: false`; row data intact |
| legacy Config | missing responseTone column | additive upgrade; customContext preserved; default `auto` |
| orphan sqlite | unrelated table only | Config + full schema appear |
| withSchemaRetry | P2022 on findUnique | recovers; data preserved |
| withSchemaRetry non-drift | P1001 | rethrows |
| other models | LLM/Calendar/ContactPolicy | CRUD works after ensure |

**Regression guarded:** desktop userData lagging package `db:push` (missing `Config.responseTone`) must not crash startup.

## Gaps intentionally not unit-tested (use T2/T5)

- Full `llmChat` network adapters (F1–F5) — need mocks/HTTP fixtures later
- `recordUserNote` OS side effects (macOS Reminders) — T5
- WhatsApp client events / re-pair — T5
- Prisma full HTTP CRUD — T2 API suite; **schema upgrade path covered in T1 `prismaSchema.test.js`**
- React component render — T3 source contracts / future Playwright

## Adding a unit test

1. Prefer pure functions; export if needed (keep side-effect free).
2. Place under `tests/unit/<area>.test.js` using `node:test`.
3. Document the case in this file + matrix ID in `TEST_MATRIX.md`.
4. Run `npm run test:unit` before push.
