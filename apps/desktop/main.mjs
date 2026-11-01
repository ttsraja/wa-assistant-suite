/**
 * WA Assistant Suite — Electron main process.
 * Starts core-engine with portable userData paths, loads control-center UI.
 */

import { app, BrowserWindow, shell } from 'electron';

// Menu bar / About name (packaged builds also set CFBundleName via electron-builder).
app.setName('WA Assistant Suite');
process.title = 'WA Assistant Suite';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
const ENGINE_PORT = Number(process.env.WA_ENGINE_PORT || 3001);
const ENGINE_HOST = process.env.WA_ENGINE_HOST || '127.0.0.1';

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {null | { baseUrl: string }} */
let engineInfo = null;
let stopping = false;

function resolveRepoRoot() {
    // apps/desktop -> repo root
    return path.resolve(__dirname, '..', '..');
}

function resolveCoreEngineEntry() {
    if (isDev) {
        return path.join(resolveRepoRoot(), 'apps', 'core-engine', 'src', 'server.js');
    }
    // Packaged: core-engine sources under resources/core-engine
    return path.join(process.resourcesPath, 'core-engine', 'src', 'server.js');
}

function resolveStaticUiDir() {
    if (process.env.WA_STATIC_UI_DIR) {
        return path.resolve(process.env.WA_STATIC_UI_DIR);
    }
    if (isDev) {
        const outDir = path.join(resolveRepoRoot(), 'apps', 'web-control-center', 'out');
        return existsSync(outDir) ? outDir : null;
    }
    const packed = path.join(process.resourcesPath, 'ui');
    return existsSync(packed) ? packed : null;
}

function resolveVersionFile() {
    if (process.env.WA_VERSION_FILE && existsSync(process.env.WA_VERSION_FILE)) {
        return process.env.WA_VERSION_FILE;
    }
    if (isDev) {
        const root = path.join(resolveRepoRoot(), 'version.json');
        return existsSync(root) ? root : null;
    }
    const packed = path.join(process.resourcesPath, 'version.json');
    return existsSync(packed) ? packed : null;
}

function readAppVersion() {
    try {
        const f = resolveVersionFile();
        if (f) {
            const j = JSON.parse(readFileSync(f, 'utf8'));
            return j.version || app.getVersion();
        }
    } catch { /* ignore */ }
    return app.getVersion();
}

function resolveDataDir() {
    if (process.env.WA_ASSISTANT_DATA_DIR) {
        return path.resolve(process.env.WA_ASSISTANT_DATA_DIR);
    }
    // Electron userData: ~/Library/Application Support/WA Assistant Suite (mac)
    // %APPDATA%/WA Assistant Suite (win)
    return app.getPath('userData');
}

async function loadEngine() {
    const entry = resolveCoreEngineEntry();
    if (!existsSync(entry)) {
        throw new Error(`core-engine entry not found: ${entry}`);
    }
    const mod = await import(pathToFileURL(entry).href);
    if (typeof mod.startEngine !== 'function') {
        throw new Error('core-engine does not export startEngine');
    }
    return mod;
}

async function bootEngine() {
    const dataDir = resolveDataDir();
    const staticUiDir = resolveStaticUiDir();
    process.env.WA_ASSISTANT_DATA_DIR = dataDir;
    const versionFile = resolveVersionFile();
    if (versionFile) process.env.WA_VERSION_FILE = versionFile;
    process.env.WA_APP_VERSION = readAppVersion();
    process.env.WA_UPDATE_CHANNEL = process.env.WA_UPDATE_CHANNEL || 'stable';
    process.env.WA_ENGINE_PORT = String(ENGINE_PORT);
    process.env.WA_ENGINE_HOST = ENGINE_HOST;
    process.env.WA_UI_ORIGIN = `http://${ENGINE_HOST}:${ENGINE_PORT}`;
    process.env.WA_API_BASE = `http://${ENGINE_HOST}:${ENGINE_PORT}`;
    if (staticUiDir) process.env.WA_STATIC_UI_DIR = staticUiDir;

    console.log('[desktop] dataDir =', dataDir);
    console.log('[desktop] staticUiDir =', staticUiDir || '(none — build UI with npm run build:ui)');
    console.log('[desktop] engine entry =', resolveCoreEngineEntry());

    const { startEngine } = await loadEngine();
    engineInfo = await startEngine({
        dataDir,
        port: ENGINE_PORT,
        host: ENGINE_HOST,
        initWhatsApp: true,
        exitProcessOnSignal: false,
        staticUiDir: staticUiDir || undefined,
    });
    return engineInfo;
}

async function waitForEngine(baseUrl, attempts = 60) {
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(`${baseUrl}/api/state`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return true;
        } catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    return false;
}

function resolveAppIcon() {
    const candidates = [
        path.join(__dirname, 'build', 'icon.png'),
        path.join(__dirname, 'build', 'icon.icns'),
        isDev ? null : path.join(process.resourcesPath, 'build', 'icon.png'),
    ].filter(Boolean);
    return candidates.find((c) => existsSync(c)) || undefined;
}

function createWindow(baseUrl) {
    const windowIcon = resolveAppIcon();
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 640,
        title: 'WA Assistant Suite',
        icon: windowIcon,
        titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
        trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
        backgroundColor: '#1c1c1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
        show: false,
    });

    mainWindow.once('ready-to-show', () => mainWindow?.show());

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Prefer engine-hosted UI (same origin for API + sockets)
    const uiUrl = `${baseUrl}/`;
    mainWindow.loadURL(uiUrl).catch(async (err) => {
        console.error('[desktop] Failed to load UI from engine:', err.message);
        const outIndex = resolveStaticUiDir() && path.join(resolveStaticUiDir(), 'index.html');
        if (outIndex && existsSync(outIndex)) {
            await mainWindow.loadFile(outIndex);
        } else {
            await mainWindow.loadURL(
                `data:text/html,<h1>WA Assistant</h1><p>Engine is up at ${baseUrl} but UI export is missing.</p><p>Run <code>npm run build:ui</code> then restart.</p>`
            );
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function shutdown() {
    if (stopping) return;
    stopping = true;
    try {
        const entry = resolveCoreEngineEntry();
        if (existsSync(entry)) {
            const mod = await import(pathToFileURL(entry).href);
            if (typeof mod.stopEngine === 'function') {
                await mod.stopEngine({ exitProcess: false });
            }
        }
    } catch (e) {
        console.warn('[desktop] stopEngine notice:', e.message);
    }
}

// Electron may still emit framework-level deprecations; keep logs clean for app authors.
process.on('warning', (warning) => {
    if (warning?.name === 'DeprecationWarning' && /textured/i.test(String(warning.message || ''))) {
        return;
    }
    console.warn(warning);
});

app.whenReady().then(async () => {
    try {
        const icon = resolveAppIcon();
        if (process.platform === 'darwin' && app.dock && icon) {
            app.dock.setIcon(icon);
        }
        if (app.setAboutPanelOptions) {
            app.setAboutPanelOptions({
                applicationName: 'WA Assistant Suite',
                applicationVersion: readAppVersion(),
                version: readAppVersion(),
                copyright: 'Copyright © WA Assistant Suite',
            });
        }

        const info = await bootEngine();
        const ok = await waitForEngine(info.baseUrl);
        if (!ok) {
            console.warn('[desktop] Engine /api/state not ready yet; opening window anyway');
        }
        createWindow(info.baseUrl);
    } catch (e) {
        console.error('[desktop] Failed to start:', e);
        app.quit();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0 && engineInfo) {
            createWindow(engineInfo.baseUrl);
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', (e) => {
    if (stopping) return;
    e.preventDefault();
    shutdown().finally(() => {
        app.exit(0);
    });
});
