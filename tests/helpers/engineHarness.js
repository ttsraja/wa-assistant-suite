/**
 * Start/stop core-engine against an isolated temp data dir (no WhatsApp init).
 * Never points at real userData or package prisma/data.db.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createServer } from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
export const CORE_ENGINE_ENTRY = path.join(REPO_ROOT, 'apps/core-engine/src/server.js');

export function createTempDataDir(prefix = 'wa-suite-test-') {
    return mkdtempSync(path.join(tmpdir(), prefix));
}

export function removeTempDataDir(dir) {
    if (!dir) return;
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}

/** Find a free TCP port on 127.0.0.1 */
export function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            const port = typeof addr === 'object' && addr ? addr.port : null;
            srv.close((err) => {
                if (err) reject(err);
                else if (!port) reject(new Error('No free port'));
                else resolve(port);
            });
        });
        srv.on('error', reject);
    });
}

async function loadEngineModule() {
    // Cache-bust not required; start/stop manages singleton runtime
    const mod = await import(pathToFileURL(CORE_ENGINE_ENTRY).href);
    return mod;
}

/**
 * @param {{ dataDir?: string, port?: number, staticUiDir?: string | null, initWhatsApp?: boolean }} [opts]
 */
export async function startTestEngine(opts = {}) {
    const dataDir = opts.dataDir || createTempDataDir();
    const port = opts.port ?? (await getFreePort());
    const { startEngine } = await loadEngineModule();

    const info = await startEngine({
        dataDir,
        port,
        host: '127.0.0.1',
        initWhatsApp: opts.initWhatsApp === true ? true : false,
        exitProcessOnSignal: false,
        staticUiDir: opts.staticUiDir || undefined,
    });

    return {
        ...info,
        dataDir,
        baseUrl: info.baseUrl || `http://127.0.0.1:${port}`,
        async stop() {
            const { stopEngine } = await loadEngineModule();
            await stopEngine({ exitProcess: false });
        },
    };
}

export async function jsonFetch(baseUrl, pathname, init = {}) {
    const res = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
    const text = await res.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    return { res, body, status: res.status, ok: res.ok };
}

/** Minimal static UI fixture for mount tests */
export function writeMinimalStaticUi(dir) {
    mkdirSync(path.join(dir, 'settings'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>WA Test</title><h1>Dashboard</h1>');
    writeFileSync(path.join(dir, 'settings', 'index.html'), '<!doctype html><title>Settings</title><h1>Settings</h1>');
    return dir;
}

export function repoHasStaticExport() {
    return existsSync(path.join(REPO_ROOT, 'apps/web-control-center/out/index.html'));
}
