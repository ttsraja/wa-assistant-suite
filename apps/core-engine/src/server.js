/**
 * Core engine HTTP + WhatsApp + Socket.IO.
 *
 * CLI:  node src/server.js  (or npm run dev:engine)
 * Embed: import { startEngine, stopEngine } from './server.js'
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';
import path from 'path';
import { existsSync, rmSync } from 'fs';
import { pathToFileURL } from 'url';
import {
    applyRuntimePaths,
    ensureDataDirectories,
    getPaths,
    getEnginePort,
    getEngineHost,
    getUiOrigin,
    resolveChromeExecutable,
    clearStaleChromiumLocks,
    killStaleSessionBrowsers,
} from './paths.js';
import { prisma, disconnectPrisma, ensureDatabaseSchema, withSchemaRetry } from './db.js';
import { handleIncomingMessage, dispatchApprovedReply } from './services/ollamaAgent.js';
import { getLLMConfig, invalidateLLMCache } from './services/llmProvider.js';
import { getCalendarConfig, invalidateCalendarCache } from './services/calendarProvider.js';
import {
    getAllContactPolicies,
    upsertContactPolicy,
    deleteContactPolicy,
    getPendingApprovals,
    approveApproval,
    rejectApproval,
    invalidatePolicyCache,
} from './services/contactPolicy.js';
import { getGoogleAuthUrl, handleGoogleAuthCallback, isGoogleConfigured } from './services/googleOauth.js';
import { ensureAppMeta, getSystemInfo } from './appMeta.js';
import { normalizeResponseTone } from './services/responseTone.js';

/** @type {null | {
 *   paths: ReturnType<typeof getPaths>,
 *   port: number,
 *   host: string,
 *   app: import('express').Express,
 *   httpServer: import('http').Server,
 *   io: import('socket.io').Server,
 *   client: import('whatsapp-web.js').Client,
 *   botState: object,
 *   isReady: boolean,
 *   isInitializing: boolean,
 *   isShuttingDown: boolean,
 *   botStartTime: number,
 *   signalHandlersAttached: boolean,
 *   exitProcessOnSignal: boolean,
 * }} */
let runtime = null;

function createInitialBotState() {
    return {
        status: 'ON',
        customContext: 'Busy at work',
        responseTone: 'auto',
        qrCode: null,
        connectionStatus: 'INITIALIZING',
        loadingProgress: null,
        user: null,
        phoneNumber: null,
        platform: null,
        error: null,
    };
}


/**
 * Best-effort identity when wwebjs is CONNECTED but `client.info` / `ready` never arrived.
 * Common on desktop when loading_screen hits 100% and state is CONNECTED while UI stays on LOADING.
 */
async function resolveWhatsAppIdentity(rt) {
    const client = rt.client;
    if (client?.info) {
        return {
            user: client.info.pushname || client.info.wid?.user || 'WhatsApp User',
            phoneNumber: client.info.wid?.user || null,
            platform: client.info.platform || null,
            source: 'client.info',
        };
    }

// Brief wait — info sometimes appears a beat after CONNECTED (keep short; /api/state polls often)
    for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 150));
        if (client?.info) {
            return {
                user: client.info.pushname || client.info.wid?.user || 'WhatsApp User',
                phoneNumber: client.info.wid?.user || null,
                platform: client.info.platform || null,
                source: 'client.info-delayed',
            };
        }
    }

    // Last resort: probe WhatsApp Web store via Puppeteer (best-effort; may fail across WA versions)
    try {
        const page = client?.pupPage;
        if (page) {
            const probe = await page.evaluate(() => {
                try {
                    const wid =
                        window.Store?.Conn?.wid ||
                        window.Store?.User?.getMeUser?.() ||
                        window.Store?.Conn?.me ||
                        null;
                    const user =
                        (wid && (wid.user || wid._serialized || wid)) ||
                        window.Store?.Conn?.pushname ||
                        null;
                    const pushname =
                        window.Store?.Conn?.pushname ||
                        window.Store?.ContactMethods?.getCurrentUser?.()?.pushname ||
                        null;
                    const phone =
                        typeof user === 'string'
                            ? String(user).replace(/@.*/, '')
                            : user?.user || null;
                    return {
                        pushname: pushname || (phone ? String(phone) : null),
                        phone: phone ? String(phone) : null,
                    };
                } catch {
                    return null;
                }
            });
            if (probe?.phone || probe?.pushname) {
                return {
                    user: probe.pushname || probe.phone || 'WhatsApp User',
                    phoneNumber: probe.phone || null,
                    platform: null,
                    source: 'puppeteer-store',
                };
            }
        }
    } catch (e) {
        console.warn('WA identity probe notice:', e.message);
    }

    return {
        user: 'WhatsApp User',
        phoneNumber: null,
        platform: null,
        source: 'synthetic',
    };
}

function applyClientInfoToState(rt, { force = false, identity = null } = {}) {
    const { client } = rt;
    const hasInfo = Boolean(client?.info || identity);
    if (!hasInfo && !force) return false;

    // During explicit re-pair, never promote to READY from stale client.info
    // until WhatsApp emits ready after a fresh QR authentication — unless forced
    // after we know the client is CONNECTED (see promoteConnectedToReady).
    if (rt.pairingInProgress && !force && !rt.pairingQrSeen) {
        return false;
    }
    if (rt.pairingInProgress && !force && !rt.pairingAuthenticated) {
        return false;
    }

    const info = client?.info;
    const user =
        identity?.user ||
        info?.pushname ||
        info?.wid?.user ||
        rt.botState.user ||
        'WhatsApp User';
    const phoneNumber =
        identity?.phoneNumber ||
        info?.wid?.user ||
        rt.botState.phoneNumber ||
        null;
    const platform = identity?.platform || info?.platform || rt.botState.platform || null;

    rt.isReady = true;
    rt.pairingInProgress = false;
    rt.pairingAuthenticated = false;
    rt._connectedTicks = 0;
    rt.botState.qrCode = null;
    rt.botState.connectionStatus = 'READY';
    rt.botState.loadingProgress = 100;
    rt.botState.user = user;
    rt.botState.phoneNumber = phoneNumber;
    rt.botState.platform = platform;
    rt.botState.error = null;
    return true;
}

/**
 * If WhatsApp reports CONNECTED (and optionally loading 100%), promote UI to READY.
 * Handles missed `ready` events which leave the dashboard stuck on "Syncing … 100%".
 */
async function promoteConnectedToReady(rt, { reason = 'promote' } = {}) {
    if (!rt || rt.isReady || rt.isShuttingDown) return false;

    // Still waiting for a fresh QR during re-pair
    if (rt.pairingInProgress && !rt.pairingAuthenticated && !rt.pairingQrSeen) {
        return false;
    }
    if (rt.pairingInProgress && rt.pairingQrSeen && !rt.pairingAuthenticated) {
        return false;
    }

    let st = null;
    try {
        st = await rt.client.getState().catch(() => null);
    } catch {
        st = null;
    }
    if (st) rt.botState.waClientState = st;

    const connected = st === 'CONNECTED';
    const loadDone =
        rt.botState.loadingProgress == null ||
        Number(rt.botState.loadingProgress) >= 100 ||
        rt.botState.connectionStatus === 'AUTHENTICATED' ||
        rt.botState.connectionStatus === 'LOADING';

    if (!connected) return false;

    // Prefer real client.info; otherwise resolve identity and force READY when load looks done
    // or we've seen CONNECTED for several watchdog ticks.
    rt._connectedTicks = (rt._connectedTicks || 0) + 1;
    const shouldForce =
        Boolean(rt.client?.info) ||
        rt._connectedTicks >= 3 ||
        Number(rt.botState.loadingProgress) >= 100 ||
        loadDone;

    if (!shouldForce) return false;

    const identity = await resolveWhatsAppIdentity(rt);
    const ok = applyClientInfoToState(rt, { force: true, identity });
    if (ok) {
        console.log(
            `🚀 WhatsApp READY (${reason}, identity=${identity.source}): ${rt.botState.user}` +
                (rt.botState.phoneNumber ? ` (${rt.botState.phoneNumber})` : '')
        );
        try {
            rt.io.emit('state', { ...rt.botState });
        } catch { /* ignore */ }
        stopReadyWatchdog(rt);
    }
    return ok;
}

function stopReadyWatchdog(rt) {
    if (!rt) return;
    if (rt._readyWatchdog) {
        clearInterval(rt._readyWatchdog);
        rt._readyWatchdog = null;
    }
}

function resetBotConnectionFields(rt, status = 'INITIALIZING') {
    rt.isReady = false;
    rt._connectedTicks = 0;
    rt.botState.connectionStatus = status;
    rt.botState.qrCode = null;
    rt.botState.user = null;
    rt.botState.phoneNumber = null;
    rt.botState.platform = null;
    rt.botState.loadingProgress = null;
    rt.botState.waClientState = null;
    rt.botState.error = null;
}

function buildPuppeteerOptions(chromeExecutablePath) {
    return {
        headless: process.env.WA_PUPPETEER_HEADLESS === 'false' ? false : 'new',
        executablePath: chromeExecutablePath,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--disable-gpu',
            '--disable-features=site-per-process',
        ],
    };
}

function createWaClient(authDataPath, chromeExecutablePath) {
    return new Client({
        authStrategy: new LocalAuth({ dataPath: authDataPath }),
        puppeteer: buildPuppeteerOptions(chromeExecutablePath),
    });
}

/** Fully tear down WA browser + LocalAuth session files for a clean QR re-pair. */
async function destroyClientAndClearSession(rt) {
    stopReadyWatchdog(rt);
    try {
        await rt.client.destroy();
    } catch (e) {
        console.warn('destroy notice:', e.message);
    }
    try {
        killStaleSessionBrowsers(rt.paths.sessionDir);
        clearStaleChromiumLocks(rt.paths.sessionDir);
    } catch { /* ignore */ }

    // Remove LocalAuth session so initialize cannot silently restore an old link
    try {
        if (existsSync(rt.paths.authDataPath)) {
            rmSync(rt.paths.authDataPath, { recursive: true, force: true });
            console.log('🧹 Cleared WhatsApp LocalAuth session at', rt.paths.authDataPath);
        }
    } catch (e) {
        console.warn('Session clear notice:', e.message);
    }
}

async function recreateWhatsAppClient(rt) {
    const chromeExecutablePath = resolveChromeExecutable();
    const client = createWaClient(rt.paths.authDataPath, chromeExecutablePath);
    rt.client = client;
    // Routes close over original client — refresh reference used by handlers via rt
    attachWhatsAppHandlers(rt);
    return client;
}


/** Poll WA client until CONNECTED/ready after QR auth (ready event can be delayed/missed). */
function startReadyWatchdog(rt) {
    if (rt._readyWatchdog) return;
    // Do not watch for ready until a QR has been shown+authenticated during re-pair
    if (rt.pairingInProgress && !rt.pairingAuthenticated) return;
    let ticks = 0;
    const maxTicks = 180; // ~3 min — desktop can sit at CONNECTED/100% without `ready`
    let promoting = false;
    rt._readyWatchdog = setInterval(async () => {
        ticks += 1;
        if (rt.isShuttingDown || rt.isReady) {
            stopReadyWatchdog(rt);
            return;
        }
        if (promoting) return;
        try {
            // Keep SCAN_QR if we still have a live QR and are pairing
            if (rt.botState.connectionStatus === 'SCAN_QR' && rt.botState.qrCode) {
                return;
            }

            if (applyClientInfoToState(rt)) {
                rt.io.emit('state', { ...rt.botState });
                console.log(`🚀 WhatsApp ready (watchdog/info): ${rt.botState.user}`);
                stopReadyWatchdog(rt);
                return;
            }

            const st = await rt.client.getState().catch(() => null);
            if (st) {
                rt.botState.waClientState = st;
                if (['OPENING', 'PAIRING', 'TIMEOUT', 'CONNECTED'].includes(st)) {
                    if (
                        rt.botState.connectionStatus === 'INITIALIZING' ||
                        rt.botState.connectionStatus === 'AUTHENTICATED'
                    ) {
                        rt.botState.connectionStatus = 'LOADING';
                        if (st === 'CONNECTED' && rt.botState.loadingProgress == null) {
                            rt.botState.loadingProgress = 100;
                        }
                        rt.io.emit('state', { ...rt.botState });
                    }
                }

                if (st === 'CONNECTED') {
                    promoting = true;
                    try {
                        const ok = await promoteConnectedToReady(rt, { reason: 'watchdog' });
                        if (ok) return;
                    } finally {
                        promoting = false;
                    }
                }
            }
        } catch (e) {
            /* ignore transient */
        }
        if (ticks >= maxTicks && !rt.isReady) {
            console.warn(
                '⚠️ Ready watchdog timed out — forcing READY check while CONNECTED/LOADING if possible'
            );
            promoting = true;
            try {
                const st = await rt.client.getState().catch(() => null);
                if (st === 'CONNECTED') {
                    const ok = await promoteConnectedToReady(rt, { reason: 'watchdog-timeout' });
                    if (ok) return;
                }
                if (!rt.isReady) {
                    rt.botState.error =
                        'WhatsApp stayed on syncing longer than expected. Try Unlink / Re-pair, or restart the app.';
                    rt.io.emit('state', { ...rt.botState });
                }
            } finally {
                promoting = false;
                // Keep polling a bit longer only if still not ready — restart interval lightly
                stopReadyWatchdog(rt);
                if (!rt.isReady && !rt.isShuttingDown) {
                    // one more delayed attempt after timeout
                    setTimeout(() => {
                        if (!rt.isReady && !rt.isShuttingDown) startReadyWatchdog(rt);
                    }, 5000);
                }
            }
        }
    }, 1000);
}

async function syncConfig(rt) {
    await withSchemaRetry(async () => {
        let conf = await prisma.config.findUnique({ where: { id: 1 } });
        if (!conf) {
            conf = await prisma.config.create({
                data: { id: 1, status: 'ON', customContext: 'Busy at work', responseTone: 'auto' },
            });
        }
        rt.botState.status = conf.status;
        rt.botState.customContext = conf.customContext;
        rt.botState.responseTone = normalizeResponseTone(conf.responseTone ?? 'auto');
    });
}

function attachWhatsAppHandlers(rt) {
    const client = rt.client;
    const io = rt.io;

    client.on('qr', async (qr) => {
        console.log('📌 WhatsApp QR Code received');
        rt.isReady = false;
        rt.pairingQrSeen = true;
        // A new QR means we are not linked yet — clear any stale identity
        rt.botState.user = null;
        rt.botState.phoneNumber = null;
        rt.botState.platform = null;
        rt.botState.qrCode = await qrcode.toDataURL(qr);
        rt.botState.connectionStatus = 'SCAN_QR';
        rt.botState.error = null;
        rt.botState.loadingProgress = null;
        io.emit('state', { ...rt.botState });
    });

    client.on('authenticated', () => {
        // Ignore spurious authenticated before any QR during re-pair
        if (rt.pairingInProgress && !rt.pairingQrSeen) {
            console.log('⏭️ Ignoring authenticated event before QR during re-pair');
            return;
        }
        console.log('🔐 WhatsApp Authenticated successfully');
        rt.pairingAuthenticated = true;
        rt.botState.qrCode = null;
        rt.botState.connectionStatus = 'AUTHENTICATED';
        rt.botState.error = null;
        io.emit('state', { ...rt.botState });
        startReadyWatchdog(rt);
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp Auth failure:', msg);
        rt.isReady = false;
        rt.botState.connectionStatus = 'AUTH_FAILURE';
        rt.botState.error = String(msg);
        io.emit('state', rt.botState);
    });

client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Loading WhatsApp Web: ${percent}% - ${message}`);
        rt.botState.loadingProgress = percent;
        // Never steal the QR screen — loading after scan is fine, but keep SCAN_QR
        // until authenticated if a QR is still being shown.
        if (rt.botState.connectionStatus === 'SCAN_QR' && rt.botState.qrCode) {
            io.emit('state', { ...rt.botState });
            return;
        }
        if (!rt.isReady) {
            if (rt.botState.connectionStatus !== 'AUTHENTICATED') {
                rt.botState.connectionStatus = 'LOADING';
            }
            io.emit('state', { ...rt.botState });
            // At 100% the `ready` event is sometimes missed — start/keep watchdog
            if (Number(percent) >= 100) {
                startReadyWatchdog(rt);
                setTimeout(() => {
                    promoteConnectedToReady(rt, { reason: 'loading-100' }).catch(() => {});
                }, 500);
            }
        }
    });

    client.on('disconnected', (reason) => {
        console.log('⚠️ WhatsApp Disconnected:', reason);
        rt.isReady = false;
        rt.botState.connectionStatus = 'DISCONNECTED';
        rt.botState.qrCode = null;
        rt.botState.user = null;
        rt.botState.phoneNumber = null;
        rt.botState.platform = null;
        rt.botState.error = String(reason);
        io.emit('state', rt.botState);
    });

client.on('change_state', (state) => {
        console.log('📡 WhatsApp state:', state);
        rt.botState.waClientState = state;
        if (state === 'CONNECTED' && (!rt.pairingInProgress || rt.pairingAuthenticated)) {
            startReadyWatchdog(rt);
            // Don't wait forever for `ready` if already CONNECTED
            setTimeout(() => {
                promoteConnectedToReady(rt, { reason: 'change_state-CONNECTED' }).catch(() => {});
            }, 750);
        }
        if (!rt.isReady && state && state !== 'CONFLICT') {
            if (
                (rt.botState.connectionStatus === 'INITIALIZING' ||
                    rt.botState.connectionStatus === 'AUTHENTICATED') &&
                !(rt.botState.qrCode)
            ) {
                rt.botState.connectionStatus = 'LOADING';
                if (state === 'CONNECTED' && rt.botState.loadingProgress == null) {
                    rt.botState.loadingProgress = 100;
                }
            }
        }
        // Preserve QR payload on emit
        io.emit('state', { ...rt.botState });
    });

    client.on('ready', () => {
        applyClientInfoToState(rt, { force: true });
        io.emit('state', { ...rt.botState });
        stopReadyWatchdog(rt);
        console.log(
            `🚀 WhatsApp Engine Connected and Ready! Logged in as: ${rt.botState.user} (${rt.botState.phoneNumber})`
        );
    });

    client.on('message_create', async (msg) => {
        if (msg.timestamp < rt.botStartTime) return;
        if (msg.fromMe) return;
        if (
            msg.isStatus ||
            msg.from === 'status@broadcast' ||
            msg.from?.includes('@newsletter') ||
            msg.from?.includes('broadcast')
        ) {
            return;
        }

        const isGroup =
            msg.isGroupMsg ||
            msg.from?.endsWith('@g.us') ||
            msg.to?.endsWith('@g.us') ||
            Boolean(msg.author);
        if (isGroup) return;

        if (!msg.body || typeof msg.body !== 'string' || !msg.body.trim()) return;

        try {
            await handleIncomingMessage(msg, rt.botState, io);
        } catch (e) {
            console.error('Error handling incoming WhatsApp message:', e);
        }
    });
}

function attachHttpRoutes(rt) {
    const { app, io } = rt;
    const clientRef = () => rt.client;

app.get('/api/state', async (req, res) => {
        try {
            // Never clobber an active QR / pairing flow from polling
            if (rt.botState.connectionStatus === 'SCAN_QR' && rt.botState.qrCode) {
                /* keep QR */
            } else if (rt.pairingInProgress && !rt.pairingAuthenticated) {
                /* wait for fresh QR auth */
            } else if (applyClientInfoToState(rt)) {
                /* READY */
            } else {
                const st = await rt.client.getState().catch(() => null);
                if (st) rt.botState.waClientState = st;
                if (st === 'CONNECTED' && (!rt.pairingInProgress || rt.pairingAuthenticated)) {
                    startReadyWatchdog(rt);
                    // UI polls every ~2.5s — use that to unstick LOADING @ 100% + CONNECTED
                    await promoteConnectedToReady(rt, { reason: 'api-state-poll' });
                }
            }
        } catch { /* ignore */ }
        try {
            const sys = getSystemInfo();
            res.json({
                ...rt.botState,
                appVersion: sys.version,
                appChannel: sys.channel,
                appName: sys.name,
            });
        } catch {
            res.json(rt.botState);
        }
    });

app.post('/api/state', async (req, res) => {
        const { status, customContext, responseTone } = req.body;
        const updateData = {};
        if (status !== undefined) updateData.status = status;
        if (customContext !== undefined) updateData.customContext = customContext;
        if (responseTone !== undefined) updateData.responseTone = normalizeResponseTone(responseTone);
        // Ensure Config row exists (fresh data dirs)
        const existing = await prisma.config.findUnique({ where: { id: 1 } });
        if (!existing) {
            await prisma.config.create({
                data: {
                    id: 1,
                    status: updateData.status || 'ON',
                    customContext: updateData.customContext ?? 'Busy at work',
                    responseTone: updateData.responseTone || 'auto',
                },
            });
        } else if (Object.keys(updateData).length > 0) {
            await prisma.config.update({ where: { id: 1 }, data: updateData });
        }
        rt.botState = { ...rt.botState, ...updateData };
        if (updateData.responseTone) rt.botState.responseTone = updateData.responseTone;
        io.emit('state', rt.botState);
        res.json(rt.botState);
    });

    app.post('/api/logout', async (req, res) => {
        try {
            console.log('Logging out / re-pair: destroying session for a fresh QR...');
            stopReadyWatchdog(rt);
            rt.pairingInProgress = true;
            rt.pairingQrSeen = false;
            rt.pairingAuthenticated = false;
            resetBotConnectionFields(rt, 'INITIALIZING');
            rt.io.emit('state', { ...rt.botState });
            res.json({ success: true, rePair: true });

            // Run teardown + re-init outside the request
            setImmediate(async () => {
                try {
                    try {
                        await rt.client.logout();
                    } catch (e) {
                        console.log('Logout notice:', e.message);
                    }
                    await destroyClientAndClearSession(rt);
                    // Ensure auth dir exists again for LocalAuth
                    ensureDataDirectories(rt.paths);
                    await recreateWhatsAppClient(rt);
                    console.log('Re-initializing client for fresh QR pairing...');
                    rt.botState.connectionStatus = 'INITIALIZING';
                    rt.io.emit('state', { ...rt.botState });
                    await rt.client.initialize();
                    // Watchdog only after QR auth — not immediately
                } catch (initErr) {
                    console.error('Error re-initializing client for re-pair:', initErr);
                    rt.botState.connectionStatus = 'ERROR';
                    rt.botState.error = initErr.message || String(initErr);
                    rt.pairingInProgress = false;
                    rt.io.emit('state', { ...rt.botState });
                }
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/logs', async (req, res) => {
        const { limit = 100, offset = 0 } = req.query;
        try {
            const parsedLimit = Number.parseInt(limit, 10);
            const parsedOffset = Number.parseInt(offset, 10);
            const take = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 100;
            const skip = Number.isInteger(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

            const logs = await prisma.conversationLog.findMany({
                take,
                skip,
                orderBy: { createdAt: 'desc' },
                include: {},
            });
            res.json(logs);
        } catch (e) {
            console.error('Error fetching conversation logs:', e);
            res.status(500).json({ error: 'Failed to fetch logs' });
        }
    });

    app.get('/api/llm-config', async (req, res) => {
        try {
            const config = await getLLMConfig();
            res.json({ ...config, apiKey: config.apiKey ? '••••••••' : '' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/llm-config', async (req, res) => {
        try {
            const { provider, modelName, apiKey, baseUrl } = req.body;
            const updateData = {};
            if (provider) updateData.provider = provider;
            if (modelName) updateData.modelName = modelName;
            if (baseUrl !== undefined) updateData.baseUrl = baseUrl || null;
            if (apiKey && apiKey !== '••••••••') updateData.apiKey = apiKey;

            const existing = await prisma.lLMConfig.findUnique({ where: { id: 1 } });
            const updated = existing
                ? await prisma.lLMConfig.update({ where: { id: 1 }, data: updateData })
                : await prisma.lLMConfig.create({
                      data: { id: 1, provider: 'ollama', modelName: 'gemma4:latest', ...updateData },
                  });
            invalidateLLMCache();
            res.json({ ...updated, apiKey: updated.apiKey ? '••••••••' : '' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/calendar-config', async (req, res) => {
        try {
            const config = await getCalendarConfig();
            res.json({
                ...config,
                authStatus: {
                    google: isGoogleConfigured() ? 'Authenticated' : 'Not configured',
                    macos: process.platform === 'darwin' ? 'Available' : 'Unavailable',
                    windows: process.platform === 'win32' ? 'Available' : 'Unavailable',
                },
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/calendar/google-auth/init', (req, res) => {
        try {
            res.json(getGoogleAuthUrl());
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.get('/api/calendar/google-auth/callback', async (req, res) => {
        const redirectUrl = new URL(`${getUiOrigin().replace(/\/$/, '')}/settings`);

        if (req.query.error) {
            redirectUrl.searchParams.set('googleAuth', 'cancelled');
            return res.redirect(302, redirectUrl.toString());
        }

        if (typeof req.query.code !== 'string' || !req.query.code) {
            redirectUrl.searchParams.set('googleAuth', 'failed');
            return res.redirect(302, redirectUrl.toString());
        }

        try {
            await handleGoogleAuthCallback(req.query.code);
            redirectUrl.searchParams.set('googleAuth', 'success');
        } catch (e) {
            console.error('Google OAuth callback failed:', e.message);
            redirectUrl.searchParams.set('googleAuth', 'failed');
        }

        return res.redirect(302, redirectUrl.toString());
    });

    app.post('/api/calendar-config', async (req, res) => {
        try {
            const { calendarProvider, tasksProvider } = req.body;
            const updateData = {};
            if (calendarProvider) updateData.calendarProvider = calendarProvider;
            if (tasksProvider) updateData.tasksProvider = tasksProvider;

            const existing = await prisma.calendarConfig.findUnique({ where: { id: 1 } });
            const updated = existing
                ? await prisma.calendarConfig.update({ where: { id: 1 }, data: updateData })
                : await prisma.calendarConfig.create({
                      data: { id: 1, calendarProvider: 'google', tasksProvider: 'google', ...updateData },
                  });
            invalidateCalendarCache();
            res.json(updated);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/contact-policies', async (req, res) => {
        try {
            res.json(await getAllContactPolicies());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/contact-policies', async (req, res) => {
        try {
            const policy = await upsertContactPolicy(req.body);
            invalidatePolicyCache(req.body.contactId);
            res.json(policy);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/contact-policies/:contactId', async (req, res) => {
        try {
            await deleteContactPolicy(decodeURIComponent(req.params.contactId));
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/approvals', async (req, res) => {
        try {
            res.json(await getPendingApprovals(req.query.status || 'pending'));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/approvals/:id/approve', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const { editedResponse } = req.body;
            const approval = await approveApproval(id, editedResponse);
            await dispatchApprovedReply(id, approval.aiDraft, clientRef(), io);
            res.json({ ok: true, approval });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/approvals/:id/reject', async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            const approval = await rejectApproval(id);
            res.json({ ok: true, approval });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/system', (req, res) => {
        try {
            res.json(getSystemInfo());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/debug', async (req, res) => {
        try {
            const clientState = await clientRef().getState().catch((e) => e.message);
            const pageUrl = clientRef().pupPage ? client.pupPage.url() : null;
            res.json({
                botState: rt.botState,
                clientState,
                info: clientRef().info || null,
                pageUrl,
                paths: {
                    dataDir: rt.paths.dataDir,
                    databaseFile: rt.paths.databaseFile,
                    authDataPath: rt.paths.authDataPath,
                },
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/screenshot', async (req, res) => {
        try {
            if (!clientRef().pupPage) return res.status(404).send('Page not available');
            const img = await clientRef().pupPage.screenshot();
            res.contentType('image/png').send(img);
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.post('/api/logs', async (req, res) => {
        try {
            const { chatId, senderName, message, response } = req.body;

            if (!chatId || !senderName || !message) {
                return res.status(400).json({
                    error: 'Missing required fields: chatId, senderName, message',
                });
            }

            const log = await prisma.conversationLog.create({
                data: {
                    chatId,
                    senderName,
                    message,
                    response: response ?? '',
                    createdAt: new Date(),
                },
            });

            res.status(201).json(log);
        } catch (e) {
            console.error('Error creating conversation log:', e);
            res.status(500).json({ error: 'Failed to create log' });
        }
    });

    io.on('connection', (socket) => socket.emit('state', rt.botState));
}

async function initBot(rt) {
    if (rt.isInitializing || rt.isShuttingDown) return;
    rt.isInitializing = true;
    const { io, paths } = rt;
    const client = rt.client;

    try {
        if (client.info && !rt.pairingInProgress) {
            applyClientInfoToState(rt, { force: true });
            console.log(
                `🚀 WhatsApp Engine Already Ready! Logged in as: ${rt.botState.user}`
            );
            io.emit('state', rt.botState);
            return;
        }

        console.log('🔄 Preparing WhatsApp Web session...');
        clearStaleChromiumLocks(paths.sessionDir);

        console.log('🔄 Initializing WhatsApp Web...');
        rt.botState.connectionStatus = 'INITIALIZING';
        io.emit('state', rt.botState);
        await client.initialize();
        // Only watch for ready if not waiting on a fresh QR re-pair
        if (!rt.pairingInProgress) {
            startReadyWatchdog(rt);
        }

        setTimeout(() => {
            if (!rt.pairingInProgress && applyClientInfoToState(rt)) {
                console.log(`✅ WhatsApp Web Ready! Logged in as: ${rt.botState.user}`);
                io.emit('state', rt.botState);
            } else {
                console.log('⚠️ WhatsApp initialization still in progress...');
                io.emit('state', { ...rt.botState });
            }
        }, 2000);
    } catch (err) {
        console.error('❌ WhatsApp initialization error:', err.message);

        if (/already running|userDataDir|SingletonLock/i.test(err.message || '')) {
            console.log('🧹 Retrying after clearing stale browser locks...');
            try {
                clearStaleChromiumLocks(paths.sessionDir);
                await new Promise((r) => setTimeout(r, 500));
                await client.initialize();
                return;
            } catch (retryErr) {
                console.error('❌ WhatsApp re-initialization failed:', retryErr.message);
                err = retryErr;
            }
        }

        if (rt.botState.status === 'ON') {
            rt.botState.connectionStatus = 'ERROR';
            rt.botState.error = err.message;
            io.emit('state', rt.botState);
        }
    } finally {
        rt.isInitializing = false;
    }
}

/**
 * Start the core engine (HTTP, Socket.IO, WhatsApp).
 *
 * @param {{
 *   dataDir?: string,
 *   port?: number,
 *   host?: string,
 *   initWhatsApp?: boolean,
 *   exitProcessOnSignal?: boolean,
 *   staticUiDir?: string,
 * }} [options]
 * @returns {Promise<{ port: number, host: string, dataDir: string, databaseFile: string, authDataPath: string, baseUrl: string }>}
 */

/**
 * Serve static control-center export (Next `out/`) from the engine HTTP server.
 * Enables one-port desktop: UI + API + Socket.IO on the same origin.
 */
function mountStaticUi(app, staticUiDir) {
    if (!staticUiDir) return;
    const root = path.resolve(staticUiDir);
    if (!existsSync(root)) {
        console.warn(`⚠️ staticUiDir not found: ${root}`);
        return;
    }

    app.use(express.static(root, { index: ['index.html'], fallthrough: true }));

    // SPA-ish fallback for client routes (e.g. /settings/)
    app.get(['/settings', '/settings/*'], (req, res, next) => {
        const candidates = [
            path.join(root, 'settings', 'index.html'),
            path.join(root, 'settings.html'),
        ];
        for (const file of candidates) {
            if (existsSync(file)) return res.sendFile(file);
        }
        next();
    });

    app.get('/', (req, res, next) => {
        const index = path.join(root, 'index.html');
        if (existsSync(index)) return res.sendFile(index);
        next();
    });

    console.log(`🖼️  Static UI mounted from ${root}`);
}

export async function startEngine(options = {}) {
    if (runtime && !runtime.isShuttingDown) {
        const { port, host, paths } = runtime;
        return {
            port,
            host,
            dataDir: paths.dataDir,
            databaseFile: paths.databaseFile,
            authDataPath: paths.authDataPath,
            baseUrl: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
        };
    }

    const paths = applyRuntimePaths({ dataDir: options.dataDir });
    ensureDataDirectories(paths);

    const port = getEnginePort(options.port);
    const host = options.host || getEngineHost();
    process.env.WA_ENGINE_PORT = String(port);

    const app = express();
    app.use(cors());
    app.use(express.json());

    const httpServer = createServer(app);
    const io = new Server(httpServer, { cors: { origin: '*' } });

    const chromeExecutablePath = resolveChromeExecutable();
    const client = createWaClient(paths.authDataPath, chromeExecutablePath);

    runtime = {
        paths,
        port,
        host,
        app,
        httpServer,
        io,
        client,
        botState: createInitialBotState(),
        isReady: false,
        isInitializing: false,
        isShuttingDown: false,
        pairingInProgress: false,
        pairingQrSeen: false,
        pairingAuthenticated: false,
        botStartTime: Math.floor(Date.now() / 1000),
        signalHandlersAttached: false,
        exitProcessOnSignal: options.exitProcessOnSignal !== false && options.exitProcessOnSignal !== undefined
            ? !!options.exitProcessOnSignal
            : false,
    };

    // Default: CLI sets exitProcessOnSignal true; embedders leave false.
    if (options.exitProcessOnSignal === true) {
        runtime.exitProcessOnSignal = true;
    }

    attachWhatsAppHandlers(runtime);
    attachHttpRoutes(runtime);

    const staticUiDir =
        options.staticUiDir ||
        process.env.WA_STATIC_UI_DIR ||
        null;
    if (staticUiDir) {
        mountStaticUi(app, staticUiDir);
    }

    await ensureDatabaseSchema();
    const appMeta = ensureAppMeta({ dataDir: paths.dataDir });
    console.log(`📦 ${appMeta.name} v${appMeta.appVersion} (${appMeta.channel})`);
    if (appMeta.upgradedThisLaunch) {
        console.log(`⬆️  Upgraded from v${appMeta.previousAppVersion} → v${appMeta.appVersion} (user data preserved)`);
    }
    await syncConfig(runtime);

    await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => resolve());
    });

    console.log(`✅ Core Engine HTTP Server running on http://${host}:${port}`);
    console.log(`📁 Data dir: ${paths.dataDir}`);
    console.log(`🗄️  Database: ${paths.databaseFile}`);
    if (chromeExecutablePath) {
        console.log(`🌐 Chrome: ${chromeExecutablePath}`);
    } else {
        console.warn('⚠️ No system Chrome/Edge found; Puppeteer will use its default binary if available.');
    }

    const initWhatsApp = options.initWhatsApp !== false;
    if (initWhatsApp) {
        await initBot(runtime);
    }

    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    return {
        port,
        host,
        dataDir: paths.dataDir,
        databaseFile: paths.databaseFile,
        authDataPath: paths.authDataPath,
        baseUrl: `http://${displayHost}:${port}`,
    };
}

/**
 * Graceful shutdown. When exitProcess is true (CLI), exits the Node process.
 *
 * @param {{ signal?: string, exitProcess?: boolean }} [options]
 */
export async function stopEngine(options = {}) {
    const rt = runtime;
    if (!rt || rt.isShuttingDown) return;
    rt.isShuttingDown = true;

    const signal = options.signal || 'stopEngine';
    console.log(`\n🛑 Shutting down core-engine (${signal})...`);

    rt.botState.connectionStatus = 'DISCONNECTED';
    stopReadyWatchdog(rt);
    try {
        rt.io.emit('state', rt.botState);
    } catch {
        /* ignore */
    }

    try {
        await rt.client.destroy();
        console.log('✅ WhatsApp client destroyed');
    } catch (e) {
        console.warn('WhatsApp destroy notice:', e.message);
        killStaleSessionBrowsers(rt.paths.sessionDir);
        clearStaleChromiumLocks(rt.paths.sessionDir);
    }

    await disconnectPrisma();

    await new Promise((resolve) => {
        rt.httpServer.close(() => resolve());
        setTimeout(resolve, 2000);
    });

    runtime = null;

    const shouldExit = options.exitProcess === true || (options.exitProcess !== false && rt.exitProcessOnSignal);
    if (shouldExit) {
        process.exit(0);
    }
}

/** Current bot state snapshot (or null if not started). */
export function getBotState() {
    return runtime ? { ...runtime.botState } : null;
}

/** Whether the engine HTTP server is running. */
export function isEngineRunning() {
    return Boolean(runtime && !runtime.isShuttingDown);
}

function attachCliSignalHandlers() {
    if (!runtime || runtime.signalHandlersAttached) return;
    runtime.signalHandlersAttached = true;
    runtime.exitProcessOnSignal = true;

    const handler = (signal) => {
        stopEngine({ signal, exitProcess: true });
    };
    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGHUP', () => handler('SIGHUP'));
}

async function runCli() {
    try {
        await startEngine({
            exitProcessOnSignal: true,
            // Match historical behavior: listen on all interfaces in CLI dev.
            host: process.env.WA_ENGINE_HOST || '0.0.0.0',
        });
        attachCliSignalHandlers();
    } catch (e) {
        console.error('Failed to start core-engine:', e);
        process.exit(1);
    }
}

// Direct CLI entry: node src/server.js / npm run dev:engine
const isDirectRun =
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
    runCli();
}
