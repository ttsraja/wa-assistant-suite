import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const pathsUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/paths.js')).href;

describe('A — paths / data dir / port / chrome', () => {
    let paths;
    let savedEnv;

    before(async () => {
        savedEnv = { ...process.env };
        paths = await import(pathsUrl);
    });

    after(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) delete process.env[key];
        }
        for (const [k, v] of Object.entries(savedEnv)) {
            process.env[k] = v;
        }
        paths.applyRuntimePaths({});
    });

    beforeEach(() => {
        delete process.env.WA_ASSISTANT_DATA_DIR;
        delete process.env.WA_ENGINE_PORT;
        delete process.env.WA_ENGINE_HOST;
        delete process.env.WA_UI_ORIGIN;
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
    });

    it('A1 default data dir uses package prisma/data.db', () => {
        const p = paths.applyRuntimePaths({ dataDir: paths.PACKAGE_ROOT });
        assert.equal(p.dataDir, path.resolve(paths.PACKAGE_ROOT));
        assert.equal(p.databaseFile, path.join(paths.PACKAGE_ROOT, 'prisma', 'data.db'));
        assert.ok(p.authDataPath.endsWith('.wwebjs_auth'));
        assert.ok(p.sessionDir.endsWith(path.join('.wwebjs_auth', 'session')));
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

    it('A2b resolveDataDir trims whitespace and env override', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-paths-env-'));
        try {
            process.env.WA_ASSISTANT_DATA_DIR = `  ${dir}  `;
            assert.equal(paths.resolveDataDir(), path.resolve(dir));
            assert.equal(paths.resolveDataDir(''), path.resolve(dir));
            assert.equal(paths.resolveDataDir('   '), path.resolve(dir));
            assert.equal(paths.resolveDataDir(null), path.resolve(dir));
            const other = mkdtempSync(path.join(tmpdir(), 'wa-paths-exp-'));
            try {
                assert.equal(paths.resolveDataDir(` ${other} `), path.resolve(other));
            } finally {
                rmSync(other, { recursive: true, force: true });
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('A2c resolveDataDir falls back to PACKAGE_ROOT when env empty', () => {
        process.env.WA_ASSISTANT_DATA_DIR = '   ';
        assert.equal(paths.resolveDataDir(), path.resolve(paths.PACKAGE_ROOT));
    });

    it('A3 DATABASE_URL matches resolved sqlite file URL', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-paths-url-'));
        try {
            const p = paths.applyRuntimePaths({ dataDir: dir });
            assert.equal(process.env.DATABASE_URL, p.databaseUrl);
            assert.ok(p.databaseUrl.startsWith('file:'));
            assert.ok(p.databaseUrl.includes('data.db'));
            assert.equal(paths.toPrismaSqliteUrl(p.databaseFile), p.databaseUrl);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('A3b toPrismaSqliteUrl handles absolute unix paths', () => {
        const url = paths.toPrismaSqliteUrl('/tmp/foo/bar.db');
        assert.equal(url, 'file:/tmp/foo/bar.db');
    });

    it('A3c toPrismaSqliteUrl handles Windows-style drive paths', () => {
        const url = paths.toPrismaSqliteUrl('C:\\Users\\x\\data.db');
        assert.match(url, /^file:C:\//);
        assert.ok(url.includes('data.db'));
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

    it('A4b ensureDataDirectories is idempotent on existing trees', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-paths-idemp-'));
        try {
            const p = paths.applyRuntimePaths({ dataDir: dir });
            paths.ensureDataDirectories(p);
            paths.ensureDataDirectories(p);
            assert.equal(existsSync(p.authDataPath), true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('getEnginePort prefers explicit finite port', () => {
        assert.equal(paths.getEnginePort(4123), 4123);
        assert.equal(paths.getEnginePort('4455'), 4455);
        assert.equal(paths.getEnginePort(0), 0);
    });

    it('getEnginePort ignores non-finite explicit and uses env', () => {
        process.env.WA_ENGINE_PORT = '3999';
        assert.equal(paths.getEnginePort(undefined), 3999);
        assert.equal(paths.getEnginePort(null), 3999);
        assert.equal(paths.getEnginePort(Number.NaN), 3999);
    });

    it('getEnginePort rejects invalid env and defaults to 3001', () => {
        process.env.WA_ENGINE_PORT = 'nope';
        assert.equal(paths.getEnginePort(), 3001);
        process.env.WA_ENGINE_PORT = '-5';
        assert.equal(paths.getEnginePort(), 3001);
        process.env.WA_ENGINE_PORT = '0';
        assert.equal(paths.getEnginePort(), 3001);
        delete process.env.WA_ENGINE_PORT;
        assert.equal(paths.getEnginePort(), 3001);
    });

    it('getEngineHost and getUiOrigin defaults and overrides', () => {
        assert.equal(paths.getEngineHost(), '127.0.0.1');
        assert.equal(paths.getUiOrigin(), 'http://localhost:3000');
        process.env.WA_ENGINE_HOST = '0.0.0.0';
        process.env.WA_UI_ORIGIN = 'http://127.0.0.1:3001';
        assert.equal(paths.getEngineHost(), '0.0.0.0');
        assert.equal(paths.getUiOrigin(), 'http://127.0.0.1:3001');
    });

    it('A7 Chrome resolution prefers PUPPETEER_EXECUTABLE_PATH', () => {
        process.env.PUPPETEER_EXECUTABLE_PATH = '/tmp/fake-chrome-for-test';
        assert.equal(paths.resolveChromeExecutable(), '/tmp/fake-chrome-for-test');
    });

    it('A7b without override returns string path or undefined', () => {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
        const chrome = paths.resolveChromeExecutable();
        assert.ok(chrome === undefined || typeof chrome === 'string');
        if (chrome) assert.equal(existsSync(chrome), true);
    });

    it('A8 clearStaleChromiumLocks safe on missing session dir', () => {
        const missing = path.join(tmpdir(), `wa-missing-session-${Date.now()}`);
        assert.doesNotThrow(() => paths.clearStaleChromiumLocks(missing));
    });

    it('A8b clearStaleChromiumLocks removes lock files when present', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-locks-'));
        try {
            const session = path.join(dir, 'session');
            mkdirSync(session, { recursive: true });
            for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
                writeFileSync(path.join(session, name), 'x');
            }
            paths.clearStaleChromiumLocks(session);
            for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
                assert.equal(existsSync(path.join(session, name)), false, name);
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('getPaths returns cached result after applyRuntimePaths', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'wa-paths-cache-'));
        try {
            const p = paths.applyRuntimePaths({ dataDir: dir });
            assert.equal(paths.getPaths().dataDir, p.dataDir);
            assert.equal(paths.getPaths().databaseFile, p.databaseFile);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('resolveDatabaseFile distinguishes package vs custom roots', () => {
        assert.equal(
            paths.resolveDatabaseFile(paths.PACKAGE_ROOT),
            path.join(paths.PACKAGE_ROOT, 'prisma', 'data.db')
        );
        const custom = path.join(tmpdir(), 'wa-custom-root');
        assert.equal(paths.resolveDatabaseFile(custom), path.join(path.resolve(custom), 'data.db'));
    });
});
