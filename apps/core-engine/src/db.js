/**
 * Shared Prisma client. Import paths first so DATABASE_URL is set before construct.
 * Use getPrisma() / disconnectPrisma(); do not construct PrismaClient in services.
 */

import './paths.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { getPaths, PACKAGE_ROOT } from './paths.js';

const execFileAsync = promisify(execFile);

/** @type {import('@prisma/client').PrismaClient | null} */
let _prisma = null;

/**
 * Singleton PrismaClient using process.env.DATABASE_URL (from applyRuntimePaths).
 * Call applyRuntimePaths({ dataDir }) before the first getPrisma() when embedding.
 */
export function getPrisma() {
    if (!_prisma) {
        // Re-read paths so DATABASE_URL matches the latest applyRuntimePaths call.
        const { databaseUrl } = getPaths();
        if (!process.env.DATABASE_URL) {
            process.env.DATABASE_URL = databaseUrl;
        }
        _prisma = new PrismaClient();
    }
    return _prisma;
}

/**
 * True when Prisma/SQLite errors indicate missing table/column (safe to db push).
 * Exported for unit tests so drift classification stays locked.
 */
export function isSchemaDriftError(e) {
    const msg = String(e?.message || e);
    const code = e?.code;
    return (
        code === 'P2021' || // table does not exist
        code === 'P2022' || // column does not exist
        code === 'P2010' ||
        /does not exist/i.test(msg) ||
        /no such table/i.test(msg) ||
        /no such column/i.test(msg) ||
        /The column .* does not exist/i.test(msg)
    );
}

/** Columns the running build expects on Config (keep in sync with schema.prisma). */
export const REQUIRED_CONFIG_COLUMNS = Object.freeze([
    'id',
    'status',
    'customContext',
    'responseTone',
    'ownerName',
]);

/** All Prisma models that must exist after a full schema push. */
export const REQUIRED_MODELS = Object.freeze([
    'Config',
    'ConversationLog',
    'LLMConfig',
    'CalendarConfig',
    'ContactPolicy',
    'PendingApproval',
]);

/**
 * Run `prisma db push` for the active DATABASE_URL (additive; preserves rows).
 */
async function pushPrismaSchema(reason = 'schema sync') {
    await disconnectPrisma();
    console.log(`🗄️  Applying Prisma schema (${reason})...`);
    try {
        await execFileAsync(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'],
            {
                cwd: PACKAGE_ROOT,
                env: { ...process.env },
                maxBuffer: 10 * 1024 * 1024,
            }
        );
    } catch (err) {
        const stderr = err.stderr?.toString?.() || err.message;
        throw new Error(`Failed to apply database schema: ${stderr}`);
    }
    getPrisma();
    return { pushed: true, reason };
}

/**
 * Ensure SQLite tables/columns match schema for the current DATABASE_URL.
 * - First run (empty DB): create tables
 * - Upgrade (e.g. new Config.responseTone): additive db push — keeps user data
 * Safe for desktop userData DBs that lag the package prisma/data.db.
 */
export async function ensureDatabaseSchema() {
    const client = getPrisma();
    let needsPush = false;
    let reason = 'first run';

try {
        // Probe required Config columns used by the running app build.
        // Missing column (P2022) means an older desktop/browser DB needs upgrade.
        // Keep column list aligned with REQUIRED_CONFIG_COLUMNS / schema.prisma.
        await client.$queryRaw`SELECT id, status, customContext, responseTone, ownerName FROM Config LIMIT 1`;
        return { pushed: false };
    } catch (e) {
        if (!isSchemaDriftError(e)) throw e;
        const msg = String(e?.message || e);
        needsPush = true;
        if (/responseTone|ownerName|column/i.test(msg) || e?.code === 'P2022') {
            reason = 'additive column upgrade';
        } else if (/no such table|P2021/i.test(msg) || e?.code === 'P2021') {
            reason = 'first run';
        } else {
            reason = 'schema drift';
        }
    }

    if (!needsPush) return { pushed: false };
    return pushPrismaSchema(reason);
}

/**
 * If a later query hits missing-column drift, push schema once and retry.
 * Used by syncConfig / startup so desktop userData upgrades without manual db:push.
 */
export async function withSchemaRetry(fn) {
    try {
        return await fn();
    } catch (e) {
        if (!isSchemaDriftError(e)) throw e;
        await pushPrismaSchema('runtime drift recovery');
        return await fn();
    }
}

/**
 * Drop the singleton after disconnect so a later start can open a new data dir.
 */
export async function disconnectPrisma() {
    if (!_prisma) return;
    const client = _prisma;
    _prisma = null;
    try {
        await client.$disconnect();
    } catch (e) {
        console.warn('Prisma disconnect notice:', e.message);
    }
}

/**
 * Proxy so existing `prisma.model` call sites keep working via getPrisma().
 */
export const prisma = new Proxy(
    {},
    {
        get(_target, prop, receiver) {
            if (prop === 'then') return undefined; // not a thenable
            const client = getPrisma();
            const value = Reflect.get(client, prop, client);
            return typeof value === 'function' ? value.bind(client) : value;
        },
    }
);
