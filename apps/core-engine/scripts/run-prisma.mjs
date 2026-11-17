/**
 * Run Prisma CLI with DATABASE_URL always set (cross-platform).
 *
 * Fresh clones often have no apps/core-engine/.env, so bare `prisma db push`
 * fails with P1012 (environment variable not found: DATABASE_URL).
 *
 * Usage (from apps/core-engine):
 *   node ./scripts/run-prisma.mjs generate
 *   node ./scripts/run-prisma.mjs db push
 */
import { spawnSync } from 'child_process';
import path from 'path';
import {
    applyRuntimePaths,
    ensureDataDirectories,
    PACKAGE_ROOT,
} from '../src/paths.js';

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: node scripts/run-prisma.mjs <prisma-args...>');
    console.error('Example: node scripts/run-prisma.mjs db push');
    process.exit(1);
}

const paths = applyRuntimePaths();
ensureDataDirectories(paths);

// Always pin the URL Prisma CLI will validate against schema.prisma env("DATABASE_URL").
process.env.DATABASE_URL = paths.databaseUrl;

const isWin = process.platform === 'win32';
const npxBin = isWin ? 'npx.cmd' : 'npx';
const prismaArgs = ['prisma', ...args];

// Ensure schema path is explicit when callers omit it.
if (!args.includes('--schema') && !args.some((a) => String(a).includes('schema.prisma'))) {
    prismaArgs.push('--schema', path.join('prisma', 'schema.prisma'));
}

const result = spawnSync(npxBin, prismaArgs, {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: 'inherit',
    shell: isWin,
});

if (result.error) {
    console.error(result.error.message || result.error);
    process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
