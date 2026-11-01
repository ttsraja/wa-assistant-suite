/**
 * paths.js — portable runtime locations for desktop + CLI.
 *
 * Env:
 *   WA_ASSISTANT_DATA_DIR  — override root data directory
 *   DATABASE_URL           — Prisma SQLite URL (set automatically if unset)
 *   PUPPETEER_EXECUTABLE_PATH — Chrome/Edge binary override
 *   WA_ENGINE_PORT         — HTTP listen port (default 3001)
 *   WA_UI_ORIGIN           — OAuth post-login redirect origin (default http://localhost:3000)
 *   WA_ENGINE_HOST         — bind host (default 127.0.0.1 for desktop-safe; 0.0.0.0 if set)
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default package root: apps/core-engine (parent of src/) */
export const PACKAGE_ROOT = path.resolve(__dirname, '..');

/** @type {null | ReturnType<typeof buildPaths>} */
let _paths = null;

function isDefaultPackageDataDir(dataDir) {
    return path.resolve(dataDir) === PACKAGE_ROOT;
}

/**
 * Absolute SQLite file path under a data root.
 * Dev (package root): prisma/data.db (existing layout).
 * Packaged / custom dir: data.db at root of data dir.
 */
export function resolveDatabaseFile(dataDir) {
    const root = path.resolve(dataDir);
    if (isDefaultPackageDataDir(root)) {
        return path.join(root, 'prisma', 'data.db');
    }
    return path.join(root, 'data.db');
}

/** Prisma `file:` URL for an absolute filesystem path (cross-platform). */
export function toPrismaSqliteUrl(absoluteDbPath) {
    const raw = String(absoluteDbPath ?? '');
    // Detect Windows drive paths before path.resolve (POSIX resolve would prefix cwd).
    const preNorm = raw.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(preNorm)) {
        return `file:${preNorm}`;
    }
    const abs = path.resolve(raw);
    // Prisma accepts file:/path on Unix and file:C:/path on Windows
    const normalized = abs.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized)) {
        return `file:${normalized}`;
    }
    return normalized.startsWith('/') ? `file:${normalized}` : `file:/${normalized}`;
}

export function resolveDataDir(explicitDataDir) {
    if (explicitDataDir && String(explicitDataDir).trim()) {
        return path.resolve(String(explicitDataDir).trim());
    }
    if (process.env.WA_ASSISTANT_DATA_DIR && process.env.WA_ASSISTANT_DATA_DIR.trim()) {
        return path.resolve(process.env.WA_ASSISTANT_DATA_DIR.trim());
    }
    return PACKAGE_ROOT;
}

function buildPaths(dataDir) {
    const root = path.resolve(dataDir);
    const databaseFile = resolveDatabaseFile(root);
    const authDataPath = path.join(root, '.wwebjs_auth');
    const sessionDir = path.join(authDataPath, 'session');
    const credentialsPath = path.join(root, 'credentials.json');
    const tokenPath = path.join(root, 'token.json');

    return {
        dataDir: root,
        databaseFile,
        databaseUrl: toPrismaSqliteUrl(databaseFile),
        authDataPath,
        sessionDir,
        credentialsPath,
        tokenPath,
        isPackageDefault: isDefaultPackageDataDir(root),
    };
}

/**
 * Apply runtime paths to process.env and module cache.
 * Must run before the first PrismaClient is constructed.
 *
 * @param {{ dataDir?: string }} [options]
 */
export function applyRuntimePaths(options = {}) {
    const dataDir = resolveDataDir(options.dataDir);
    const paths = buildPaths(dataDir);

    process.env.WA_ASSISTANT_DATA_DIR = paths.dataDir;
    // Always set DATABASE_URL so Prisma and CLI agree with the active data dir.
    process.env.DATABASE_URL = paths.databaseUrl;

    _paths = paths;
    return paths;
}

/**
 * Ensure data directories exist (DB parent, WA auth). Does not create the DB file.
 */
export function ensureDataDirectories(paths = getPaths()) {
    mkdirSync(path.dirname(paths.databaseFile), { recursive: true });
    mkdirSync(paths.authDataPath, { recursive: true });
    return paths;
}

/** Current paths; applies defaults if never configured. */
export function getPaths() {
    if (!_paths) {
        return applyRuntimePaths();
    }
    return _paths;
}

export function getEnginePort(explicitPort) {
    if (explicitPort != null && Number.isFinite(Number(explicitPort))) {
        return Number(explicitPort);
    }
    const fromEnv = Number.parseInt(process.env.WA_ENGINE_PORT || '', 10);
    return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 3001;
}

export function getEngineHost() {
    return process.env.WA_ENGINE_HOST || '127.0.0.1';
}

export function getUiOrigin() {
    return process.env.WA_UI_ORIGIN || 'http://localhost:3000';
}

/**
 * System Chrome/Edge for Puppeteer (not Electron's Chromium).
 */
export function resolveChromeExecutable() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const candidates = [];
    if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        );
    } else if (process.platform === 'win32') {
        const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
        const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const local = process.env.LOCALAPPDATA || '';
        candidates.push(
            path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        );
    } else {
        candidates.push(
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium'
        );
    }

    for (const p of candidates) {
        if (p && existsSync(p)) return p;
    }
    return undefined;
}

/**
 * Kill only browser processes bound to this WhatsApp session userDataDir.
 */
export function killStaleSessionBrowsers(sessionDir = getPaths().sessionDir) {
    const target = path.resolve(sessionDir);
    try {
        if (process.platform === 'win32') {
            // Best-effort: PowerShell filter command lines containing the session path.
            const escaped = target.replace(/'/g, "''");
            execSync(
                `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
                { stdio: 'ignore' }
            );
        } else {
            execSync(`pkill -f ${JSON.stringify(target)} || true`, { stdio: 'ignore' });
        }
    } catch {
        // no matching processes
    }
}

/**
 * Clear Chromium profile locks left after hard kills.
 */
export function clearStaleChromiumLocks(sessionDir = getPaths().sessionDir) {
    killStaleSessionBrowsers(sessionDir);
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
        const lockPath = path.join(sessionDir, name);
        try {
            if (existsSync(lockPath)) rmSync(lockPath, { force: true });
        } catch (e) {
            console.warn(`⚠️ Could not remove ${name}:`, e.message);
        }
    }
}

// Apply defaults on import so CLI `node src/server.js` and services get a DB URL
// before PrismaClient is first constructed (unless caller set env already).
if (!process.env.DATABASE_URL || !process.env.WA_ASSISTANT_DATA_DIR) {
    applyRuntimePaths();
}
