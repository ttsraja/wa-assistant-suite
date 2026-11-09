/**
 * Strong Prisma / SQLite schema tests (A5 + desktop upgrade path).
 * Uses temp data dirs only — never real userData.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const pathsUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/paths.js')).href;
const dbUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/db.js')).href;
const schemaPath = path.join(REPO_ROOT, 'apps/core-engine/prisma/schema.prisma');

function sqlite(dbFile, sql) {
    return execFileSync('sqlite3', [dbFile, sql], { encoding: 'utf8' }).trim();
}

function createTempDataDir() {
    return mkdtempSync(path.join(tmpdir(), 'wa-prisma-'));
}

describe('A5 — Prisma schema durability & additive upgrades', () => {
    let paths;
    let db;
    let savedEnv;
    /** @type {string[]} */
    const dirs = [];

    before(async () => {
        savedEnv = {
            WA_ASSISTANT_DATA_DIR: process.env.WA_ASSISTANT_DATA_DIR,
            DATABASE_URL: process.env.DATABASE_URL,
        };
        paths = await import(pathsUrl);
        db = await import(dbUrl);
    });

    after(async () => {
        try {
            await db.disconnectPrisma();
        } catch { /* ignore */ }
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        paths.applyRuntimePaths({});
        for (const d of dirs) {
            try {
                rmSync(d, { recursive: true, force: true });
            } catch { /* ignore */ }
        }
    });

    beforeEach(async () => {
        await db.disconnectPrisma();
    });

    async function openTempDb(dir) {
        dirs.push(dir);
        paths.applyRuntimePaths({ dataDir: dir });
        process.env.WA_ASSISTANT_DATA_DIR = dir;
        process.env.DATABASE_URL = paths.getPaths().databaseUrl;
        return paths.getPaths();
    }

    it('schema.prisma declares all required models and Config.responseTone/ownerName', () => {
        const schema = readFileSync(schemaPath, 'utf8');
        for (const model of db.REQUIRED_MODELS) {
            assert.match(schema, new RegExp(`model\\s+${model}\\b`), `missing model ${model}`);
        }
        assert.match(schema, /model\s+Config\b/);
        assert.match(schema, /responseTone\s+String/);
        assert.match(schema, /ownerName\s+String/);
        assert.match(schema, /@default\("auto"\)/);
        for (const col of db.REQUIRED_CONFIG_COLUMNS) {
            if (col === 'id') continue;
            assert.match(schema, new RegExp(`\\b${col}\\b`), `Config missing ${col}`);
        }
    });

    it('isSchemaDriftError classifies table/column missing codes', () => {
        assert.equal(db.isSchemaDriftError({ code: 'P2021', message: 'x' }), true);
        assert.equal(db.isSchemaDriftError({ code: 'P2022', message: 'column' }), true);
        assert.equal(db.isSchemaDriftError({ code: 'P2010', message: 'raw' }), true);
        assert.equal(db.isSchemaDriftError({ message: 'no such table: Config' }), true);
        assert.equal(db.isSchemaDriftError({ message: 'no such column: responseTone' }), true);
        assert.equal(
            db.isSchemaDriftError({
                message: "The column `main.Config.responseTone` does not exist in the current database.",
            }),
            true
        );
        assert.equal(db.isSchemaDriftError({ code: 'P2002', message: 'unique' }), false);
        assert.equal(db.isSchemaDriftError({ message: 'connection refused' }), false);
        assert.equal(db.isSchemaDriftError(null), false);
    });

    it('empty data dir: first-run push creates full schema (all models)', async () => {
        const dir = createTempDataDir();
        const p = await openTempDb(dir);
        assert.equal(existsSync(p.databaseFile), false);

        const result = await db.ensureDatabaseSchema();
        assert.equal(result.pushed, true);
        assert.ok(existsSync(p.databaseFile));

        // All required tables present
        const tables = sqlite(p.databaseFile, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
        for (const model of db.REQUIRED_MODELS) {
            assert.match(tables, new RegExp(`\\b${model}\\b`), `table ${model}`);
        }

        // Config columns include responseTone
        const cols = sqlite(p.databaseFile, 'PRAGMA table_info(Config);');
        for (const col of db.REQUIRED_CONFIG_COLUMNS) {
            assert.match(cols, new RegExp(`\\|${col}\\|`), `column ${col}`);
        }

        // Prisma client can CRUD Config
        const conf = await db.prisma.config.create({
            data: { id: 1, status: 'ON', customContext: 'seed', responseTone: 'formal' },
        }).catch(async () => {
            // may already exist from push defaults in some prisma versions
            return db.prisma.config.upsert({
                where: { id: 1 },
                create: { id: 1, status: 'ON', customContext: 'seed', responseTone: 'formal' },
                update: { customContext: 'seed', responseTone: 'formal' },
            });
        });
        assert.equal(conf.customContext, 'seed');
        assert.equal(conf.responseTone, 'formal');
    });

    it('second ensureDatabaseSchema is no-op when already current', async () => {
        const dir = createTempDataDir();
        await openTempDb(dir);
        const first = await db.ensureDatabaseSchema();
        assert.equal(first.pushed, true);
        await db.prisma.config.upsert({
            where: { id: 1 },
            create: { id: 1, status: 'OFF', customContext: 'keep-me', responseTone: 'concise' },
            update: { status: 'OFF', customContext: 'keep-me', responseTone: 'concise' },
        });
        await db.disconnectPrisma();
        paths.applyRuntimePaths({ dataDir: dir });
        process.env.DATABASE_URL = paths.getPaths().databaseUrl;

        const second = await db.ensureDatabaseSchema();
        assert.equal(second.pushed, false);

        const conf = await db.prisma.config.findUnique({ where: { id: 1 } });
        assert.equal(conf.customContext, 'keep-me');
        assert.equal(conf.responseTone, 'concise');
        assert.equal(conf.status, 'OFF');
    });

    it('legacy Config without responseTone upgrades additively and preserves rows', async () => {
        const dir = createTempDataDir();
        const p = await openTempDb(dir);
        // Simulate pre-responseTone desktop DB
        sqlite(
            p.databaseFile,
            `CREATE TABLE Config (
                id INTEGER PRIMARY KEY NOT NULL,
                status TEXT NOT NULL DEFAULT 'ON',
                customContext TEXT NOT NULL DEFAULT ''
            );
            INSERT INTO Config (id, status, customContext) VALUES (1, 'ON', 'Busy at work');`
        );
        const before = sqlite(p.databaseFile, 'SELECT customContext FROM Config WHERE id=1;');
        assert.equal(before, 'Busy at work');
        assert.doesNotMatch(
            sqlite(p.databaseFile, 'PRAGMA table_info(Config);'),
            /responseTone/
        );

        const result = await db.ensureDatabaseSchema();
        assert.equal(result.pushed, true);
        assert.ok(/upgrade|drift|first/i.test(result.reason || ''));

        const conf = await db.prisma.config.findUnique({ where: { id: 1 } });
        assert.ok(conf, 'Config row must survive');
        assert.equal(conf.customContext, 'Busy at work');
        assert.equal(conf.status, 'ON');
        // Prisma default for new column
        assert.equal(conf.responseTone, 'auto');

        // Other app models also exist after push
        const tables = sqlite(p.databaseFile, "SELECT name FROM sqlite_master WHERE type='table';");
        assert.match(tables, /LLMConfig/);
        assert.match(tables, /ContactPolicy/);
        assert.match(tables, /PendingApproval/);
    });

    it('missing Config table (empty sqlite file) still gets full schema', async () => {
        const dir = createTempDataDir();
        const p = await openTempDb(dir);
        // Touch empty-ish db with unrelated table only
        sqlite(p.databaseFile, 'CREATE TABLE orphan (id INTEGER);');
        const result = await db.ensureDatabaseSchema();
        assert.equal(result.pushed, true);
        const tables = sqlite(p.databaseFile, "SELECT name FROM sqlite_master WHERE type='table';");
        assert.match(tables, /Config/);
        await db.prisma.config.upsert({
            where: { id: 1 },
            create: { id: 1, status: 'ON', customContext: '', responseTone: 'auto' },
            update: {},
        });
        const conf = await db.prisma.config.findUnique({ where: { id: 1 } });
        assert.ok(conf);
    });

    it('withSchemaRetry recovers from missing-column error without wiping data', async () => {
        const dir = createTempDataDir();
        const p = await openTempDb(dir);
        sqlite(
            p.databaseFile,
            `CREATE TABLE Config (id INTEGER PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'ON', customContext TEXT NOT NULL DEFAULT '');
             INSERT INTO Config (id, status, customContext) VALUES (1, 'ON', 'preserve-retry');`
        );

        // Force client to see drift via findUnique (P2022)
        const conf = await db.withSchemaRetry(async () => {
            return db.prisma.config.findUnique({ where: { id: 1 } });
        });
        assert.ok(conf);
        assert.equal(conf.customContext, 'preserve-retry');
        assert.equal(conf.responseTone, 'auto');
    });

    it('withSchemaRetry rethrows non-drift errors', async () => {
        await assert.rejects(
            () =>
                db.withSchemaRetry(async () => {
                    const err = new Error('connection refused');
                    err.code = 'P1001';
                    throw err;
                }),
            /connection refused/
        );
    });

    it('LLMConfig / CalendarConfig / policies usable after ensure', async () => {
        const dir = createTempDataDir();
        await openTempDb(dir);
        await db.ensureDatabaseSchema();

        const llm = await db.prisma.lLMConfig.upsert({
            where: { id: 1 },
            create: { id: 1, provider: 'ollama', modelName: 'test' },
            update: { modelName: 'test' },
        });
        assert.equal(llm.provider, 'ollama');

        const cal = await db.prisma.calendarConfig.upsert({
            where: { id: 1 },
            create: { id: 1, calendarProvider: 'macos', tasksProvider: 'macos' },
            update: { calendarProvider: 'macos', tasksProvider: 'macos' },
        });
        assert.equal(cal.calendarProvider, 'macos');

        const policy = await db.prisma.contactPolicy.upsert({
            where: { contactId: 'test@c.us' },
            create: {
                contactId: 'test@c.us',
                displayName: 'Test',
                tone: 'formal',
                requiresApproval: false,
            },
            update: { tone: 'formal' },
        });
        assert.equal(policy.tone, 'formal');

        await db.prisma.contactPolicy.delete({ where: { contactId: 'test@c.us' } });
    });
});
