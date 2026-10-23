import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const pathsUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/paths.js')).href;

describe('A — paths / data dir', () => {
    let paths;
    let savedEnv;

    before(async () => {
        savedEnv = {
            WA_ASSISTANT_DATA_DIR: process.env.WA_ASSISTANT_DATA_DIR,
            DATABASE_URL: process.env.DATABASE_URL,
            PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
        };
        paths = await import(pathsUrl);
    });

    after(() => {
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        // Restore package defaults for other suites
        paths.applyRuntimePaths({});
    });

    it('A1 default data dir uses package prisma/data.db', () => {
        delete process.env.WA_ASSISTANT_DATA_DIR;
        const p = paths.applyRuntimePaths({ dataDir: paths.PACKAGE_ROOT });
        assert.equal(p.dataDir, path.resolve(paths.PACKAGE_ROOT));
        assert.equal(p.databaseFile, path.join(paths.PACKAGE_ROOT, 'prisma', 'data.db'));
        assert.ok(p.authDataPath.endsWith('.wwebjs_auth'));
        assert.equal(p.isPackageDefault, true);
    });

    it('A2 custom data dir uses root data.db and auth under root', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-paths-'));
        try {
            const p = paths.applyRuntimePaths({ dataDir: dir });
            assert.equal(p.dataDir, path.resolve(dir));
            assert.equal(p.databaseFile, path.join(path.resolve(dir), 'data.db'));
            assert.equal(p.authDataPath, path.join(path.resolve(dir), '.wwebjs_auth'));
            assert.equal(p.credentialsPath, path.join(path.resolve(dir), 'credentials.json'));
            assert.equal(p.tokenPath, path.join(path.resolve(dir), 'token.json'));
            assert.equal(p.isPackageDefault, false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('A3 DATABASE_URL matches resolved sqlite file URL', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-paths-url-'));
        try {
            const p = paths.applyRuntimePaths({ dataDir: dir });
            assert.equal(process.env.DATABASE_URL, p.databaseUrl);
            assert.ok(p.databaseUrl.startsWith('file:'));
            assert.ok(p.databaseUrl.includes('data.db'));
            const roundTrip = paths.toPrismaSqliteUrl(p.databaseFile);
            assert.equal(roundTrip, p.databaseUrl);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('A4 ensureDataDirectories creates parents without wiping files', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-paths-ensure-'));
        try {
            const p = paths.applyRuntimePaths({ dataDir: dir });
            mkdirSync(path.dirname(p.databaseFile), { recursive: true });
            writeFileSync(p.databaseFile, 'keep-me');
            paths.ensureDataDirectories(p);
            assert.equal(existsSync(p.databaseFile), true);
assert.equal(existsSync(p.authDataPath), true);
            assert.equal(readFileSync(p.databaseFile, 'utf8'), 'keep-me');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('A7 Chrome resolution prefers PUPPETEER_EXECUTABLE_PATH', () => {
        process.env.PUPPETEER_EXECUTABLE_PATH = '/tmp/fake-chrome-for-test';
        assert.equal(paths.resolveChromeExecutable(), '/tmp/fake-chrome-for-test');
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
    });

    it('A8 clearStaleChromiumLocks safe on missing session dir', () => {
        const missing = path.join(tmpdir(), `wa-missing-session-${Date.now()}`);
        assert.doesNotThrow(() => paths.clearStaleChromiumLocks(missing));
    });
});
