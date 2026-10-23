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
 * Ensure SQLite tables exist for the current DATABASE_URL (first run in a new data dir).
 * Uses `prisma db push` against apps/core-engine schema; safe on empty DBs.
 */
export async function ensureDatabaseSchema() {
    const client = getPrisma();
    try {
await client.$queryRaw`SELECT 1 FROM Config LIMIT 1`;
        return { pushed: false };
    } catch (e) {
        const msg = String(e?.message || e);
        const missing =
            e?.code === 'P2021' ||
            e?.code === 'P2010' ||
            /does not exist/i.test(msg) ||
            /no such table/i.test(msg);
        if (!missing) throw e;
    }

    // Drop client so push can open the file; reconnect afterward.
    await disconnectPrisma();

    console.log('🗄️  Applying Prisma schema to database (first run)...');
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

    // Recreate client after push
    getPrisma();
    return { pushed: true };
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
