/**
 * Application identity + durable upgrade metadata.
 *
 * User data (DB, WA session, OAuth) lives under the data dir and is NEVER wiped
 * on app binary upgrades. This module only records version history in meta.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPaths, PACKAGE_ROOT } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FALLBACK = {
    name: 'WA Assistant Suite',
    version: '1.0.0',
    schemaVersion: 1,
    channel: 'stable',
    productId: 'dev.waassistant.suite',
};

function readJsonSafe(filePath) {
    try {
        if (!existsSync(filePath)) return null;
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/** Locate version.json (repo root, packaged resources, or env). */
export function loadVersionManifest() {
    const candidates = [
        process.env.WA_VERSION_FILE,
        path.resolve(PACKAGE_ROOT, '../../version.json'),
        path.resolve(PACKAGE_ROOT, '../version.json'),
        path.resolve(PACKAGE_ROOT, 'version.json'),
        path.resolve(__dirname, '../../../version.json'),
    ].filter(Boolean);

    for (const c of candidates) {
        const j = readJsonSafe(c);
        if (j?.version) return { ...FALLBACK, ...j, _source: c };
    }

    // package.json fallbacks
    const pkgCandidates = [
        path.resolve(PACKAGE_ROOT, '../../package.json'),
        path.resolve(PACKAGE_ROOT, 'package.json'),
        path.resolve(PACKAGE_ROOT, '../desktop/package.json'),
    ];
    for (const c of pkgCandidates) {
        const j = readJsonSafe(c);
        if (j?.version) {
            return {
                ...FALLBACK,
                name: j.productName || j.name || FALLBACK.name,
                version: j.version,
                _source: c,
            };
        }
    }

    return {
        ...FALLBACK,
        version: process.env.WA_APP_VERSION || FALLBACK.version,
        channel: process.env.WA_UPDATE_CHANNEL || FALLBACK.channel,
        _source: 'fallback',
    };
}

function metaPath(dataDir = getPaths().dataDir) {
    return path.join(dataDir, 'app-meta.json');
}

/**
 * Ensure app-meta.json exists; record upgrades without touching DB/session.
 * Optionally snapshots meta history (not the DB) for audit.
 */
export function ensureAppMeta(options = {}) {
    const paths = getPaths();
    const dataDir = options.dataDir || paths.dataDir;
    mkdirSync(dataDir, { recursive: true });

    const manifest = loadVersionManifest();
    const file = metaPath(dataDir);
    const now = new Date().toISOString();
    const prev = readJsonSafe(file);

    const next = {
        productId: manifest.productId,
        name: manifest.name,
        channel: process.env.WA_UPDATE_CHANNEL || manifest.channel || 'stable',
        appVersion: process.env.WA_APP_VERSION || manifest.version,
        schemaVersion: manifest.schemaVersion ?? 1,
        dataDir,
        databaseFile: paths.databaseFile,
        authDataPath: paths.authDataPath,
firstInstalledAt: prev?.firstInstalledAt || now,
        lastStartedAt: now,
        // Keep last-known prior version across repeated ensureAppMeta calls in one process
        previousAppVersion: prev?.previousAppVersion || null,
        upgradeHistory: Array.isArray(prev?.upgradeHistory) ? [...prev.upgradeHistory] : [],
        durability: {
            preservesDatabase: true,
            preservesWhatsAppSession: true,
            preservesOAuthTokens: true,
            preservesPoliciesAndLogs: true,
            note:
                'App binary upgrades replace the install directory only. Runtime state stays in the data directory and survives updates.',
        },
    };

    const upgraded =
        prev?.appVersion &&
        prev.appVersion !== next.appVersion;

if (upgraded) {
        next.previousAppVersion = prev.appVersion;
        next.upgradeHistory.push({
            from: prev.appVersion,
            to: next.appVersion,
            at: now,
            schemaFrom: prev.schemaVersion ?? null,
            schemaTo: next.schemaVersion,
        });
        // Keep last 20 upgrade events
        if (next.upgradeHistory.length > 20) {
            next.upgradeHistory = next.upgradeHistory.slice(-20);
        }
        next.lastUpgradedAt = now;

        // Lightweight meta backup only (never deletes DB)
        try {
            const bak = path.join(dataDir, `app-meta.pre-upgrade-${prev.appVersion}.json`);
            if (existsSync(file)) copyFileSync(file, bak);
        } catch {
            /* non-fatal */
        }
    } else {
        next.lastUpgradedAt = prev?.lastUpgradedAt || null;
    }

    writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });

    return {
        ...next,
        upgradedThisLaunch: Boolean(upgraded),
        manifestSource: manifest._source,
    };
}

export function getSystemInfo() {
    const paths = getPaths();
    const meta = ensureAppMeta({ dataDir: paths.dataDir });
    const manifest = loadVersionManifest();

    return {
        name: meta.name,
        version: meta.appVersion,
        channel: meta.channel,
        productId: meta.productId,
        schemaVersion: meta.schemaVersion,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        dataDir: paths.dataDir,
        databaseFile: paths.databaseFile,
        authDataPath: paths.authDataPath,
        credentialsPath: paths.credentialsPath,
        firstInstalledAt: meta.firstInstalledAt,
        lastStartedAt: meta.lastStartedAt,
        lastUpgradedAt: meta.lastUpgradedAt,
        previousAppVersion: meta.previousAppVersion,
        upgradedThisLaunch: meta.upgradedThisLaunch,
        upgradeHistory: meta.upgradeHistory || [],
        durability: meta.durability,
        update: {
            // Placeholder for electron-updater / private feed; UI can poll this shape
            supported: Boolean(process.env.WA_UPDATE_FEED_URL),
            feedUrl: process.env.WA_UPDATE_FEED_URL || null,
            channel: meta.channel,
            checkAutomatically: process.env.WA_UPDATE_AUTO_CHECK === '1',
        },
        manifestSource: meta.manifestSource || manifest._source,
    };
}
