import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const pathsUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/paths.js')).href;
const metaUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/appMeta.js')).href;

describe('A6 — appMeta version / upgrade durability', () => {
    let paths;
    let appMeta;
    let savedEnv;
    let dataDir;

    before(async () => {
        savedEnv = {
            WA_APP_VERSION: process.env.WA_APP_VERSION,
            WA_UPDATE_CHANNEL: process.env.WA_UPDATE_CHANNEL,
            WA_VERSION_FILE: process.env.WA_VERSION_FILE,
            WA_UPDATE_FEED_URL: process.env.WA_UPDATE_FEED_URL,
            WA_UPDATE_AUTO_CHECK: process.env.WA_UPDATE_AUTO_CHECK,
        };
        paths = await import(pathsUrl);
        appMeta = await import(metaUrl);
    });

    after(() => {
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        if (dataDir) rmSync(dataDir, { recursive: true, force: true });
        paths.applyRuntimePaths({});
    });

    beforeEach(() => {
        if (dataDir) rmSync(dataDir, { recursive: true, force: true });
        dataDir = mkdtempSync(path.join(tmpdir(), 'wa-meta-'));
        // seed a dummy db file that must never be deleted by ensureAppMeta
        writeFileSync(path.join(dataDir, 'data.db'), 'user-db');
        writeFileSync(path.join(dataDir, 'token.json'), '{}');
        paths.applyRuntimePaths({ dataDir });
        delete process.env.WA_APP_VERSION;
        delete process.env.WA_UPDATE_CHANNEL;
        delete process.env.WA_UPDATE_FEED_URL;
        delete process.env.WA_UPDATE_AUTO_CHECK;
    });

    it('loadVersionManifest reads repo version.json', () => {
        const m = appMeta.loadVersionManifest();
        assert.ok(m.version);
        assert.ok(m.productId || m.name);
        assert.ok(m._source);
    });

    it('ensureAppMeta first install writes meta and preserves user files', () => {
        process.env.WA_APP_VERSION = '1.0.0';
        const meta = appMeta.ensureAppMeta({ dataDir });
        assert.equal(meta.appVersion, '1.0.0');
        assert.equal(meta.upgradedThisLaunch, false);
        assert.ok(meta.firstInstalledAt);
        assert.ok(existsSync(path.join(dataDir, 'app-meta.json')));
        assert.equal(readFileSync(path.join(dataDir, 'data.db'), 'utf8'), 'user-db');
        assert.equal(readFileSync(path.join(dataDir, 'token.json'), 'utf8'), '{}');
        assert.equal(meta.durability.preservesDatabase, true);
        assert.equal(meta.durability.preservesWhatsAppSession, true);
        assert.equal(meta.durability.preservesOAuthTokens, true);
    });

    it('ensureAppMeta same version does not append upgrade history', () => {
        process.env.WA_APP_VERSION = '1.0.0';
        const first = appMeta.ensureAppMeta({ dataDir });
        const second = appMeta.ensureAppMeta({ dataDir });
        assert.equal(second.upgradedThisLaunch, false);
        assert.equal(second.firstInstalledAt, first.firstInstalledAt);
        assert.equal((second.upgradeHistory || []).length, 0);
    });

    it('ensureAppMeta version bump records history and keeps DB/token', () => {
        process.env.WA_APP_VERSION = '1.0.0';
        appMeta.ensureAppMeta({ dataDir });
        process.env.WA_APP_VERSION = '1.1.0';
        const upgraded = appMeta.ensureAppMeta({ dataDir });
        assert.equal(upgraded.upgradedThisLaunch, true);
        assert.equal(upgraded.previousAppVersion, '1.0.0');
        assert.equal(upgraded.appVersion, '1.1.0');
        assert.ok(upgraded.upgradeHistory.some((e) => e.from === '1.0.0' && e.to === '1.1.0'));
        assert.ok(existsSync(path.join(dataDir, 'app-meta.pre-upgrade-1.0.0.json')));
        assert.equal(readFileSync(path.join(dataDir, 'data.db'), 'utf8'), 'user-db');
        assert.equal(readFileSync(path.join(dataDir, 'token.json'), 'utf8'), '{}');
    });

    it('upgrade history capped at 20 entries', () => {
        process.env.WA_APP_VERSION = '0.0.0';
        appMeta.ensureAppMeta({ dataDir });
        for (let i = 1; i <= 25; i++) {
            process.env.WA_APP_VERSION = `0.0.${i}`;
            appMeta.ensureAppMeta({ dataDir });
        }
        const meta = appMeta.ensureAppMeta({ dataDir });
        assert.ok(meta.upgradeHistory.length <= 20);
        assert.equal(meta.upgradeHistory[meta.upgradeHistory.length - 1].to, '0.0.25');
    });

    it('getSystemInfo includes durability and update shape', () => {
        process.env.WA_APP_VERSION = '1.0.0';
        process.env.WA_UPDATE_FEED_URL = 'https://example.com/feed';
        process.env.WA_UPDATE_AUTO_CHECK = '1';
        const info = appMeta.getSystemInfo();
        assert.equal(info.version, '1.0.0');
        assert.equal(info.dataDir, dataDir);
        assert.ok(String(info.databaseFile).startsWith(dataDir));
        assert.equal(info.durability.preservesDatabase, true);
        assert.equal(info.update.supported, true);
        assert.equal(info.update.feedUrl, 'https://example.com/feed');
        assert.equal(info.update.checkAutomatically, true);
        assert.ok(info.platform);
        assert.ok(info.node);
    });

    it('corrupt app-meta.json is treated as fresh install', () => {
        writeFileSync(path.join(dataDir, 'app-meta.json'), '{not-json');
        process.env.WA_APP_VERSION = '2.0.0';
        const meta = appMeta.ensureAppMeta({ dataDir });
        assert.equal(meta.appVersion, '2.0.0');
        assert.equal(meta.upgradedThisLaunch, false);
        assert.equal(readFileSync(path.join(dataDir, 'data.db'), 'utf8'), 'user-db');
    });
});
