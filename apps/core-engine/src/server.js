import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { handleIncomingMessage, dispatchApprovedReply } from './services/ollamaAgent.js';
import { getLLMConfig, invalidateLLMCache } from './services/llmProvider.js';
import { getCalendarConfig, invalidateCalendarCache } from './services/calendarProvider.js';
import { getAllContactPolicies, upsertContactPolicy, deleteContactPolicy, getPendingApprovals, approveApproval, rejectApproval, invalidatePolicyCache } from './services/contactPolicy.js';
import { getGoogleAuthUrl, handleGoogleAuthCallback, isGoogleConfigured } from './services/googleOauth.js';
import { existsSync } from 'fs';

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

let botState = {
    status: 'ON',
    customContext: 'Busy at work',
    qrCode: null,
    connectionStatus: 'INITIALIZING',
    loadingProgress: null,
    user: null,
    error: null
};

// Ensure config exists in DB
async function syncConfig() {
    let conf = await prisma.config.findUnique({ where: { id: 1 } });
    if (!conf) conf = await prisma.config.create({ data: { id: 1, status: 'ON', customContext: 'Busy at work' } });
    botState.status = conf.status;
    botState.customContext = conf.customContext;
}
syncConfig();

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (existsSync(chromePath) ? chromePath : undefined);

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        executablePath: chromeExecutablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

let isReady = false;

client.on('qr', async (qr) => {
    console.log('📌 WhatsApp QR Code received');
    isReady = false;
    botState.qrCode = await qrcode.toDataURL(qr);
    botState.connectionStatus = 'SCAN_QR';
    botState.error = null;
    io.emit('state', botState);
});

client.on('authenticated', () => {
    console.log('🔐 WhatsApp Authenticated successfully');
    botState.qrCode = null;
    botState.connectionStatus = 'AUTHENTICATED';
    botState.error = null;
    io.emit('state', botState);
});

client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp Auth failure:', msg);
    isReady = false;
    botState.connectionStatus = 'AUTH_FAILURE';
    botState.error = String(msg);
    io.emit('state', botState);
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Loading WhatsApp Web: ${percent}% - ${message}`);
    botState.loadingProgress = percent;
    if (!isReady && !client.info) {
        botState.connectionStatus = 'LOADING';
        botState.qrCode = null;
        io.emit('state', botState);
    }
});

client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp Disconnected:', reason);
    isReady = false;
    botState.connectionStatus = 'DISCONNECTED';
    botState.qrCode = null;
    botState.user = null;
    botState.phoneNumber = null;
    botState.platform = null;
    botState.error = String(reason);
    io.emit('state', botState);
});

client.on('ready', () => {
    isReady = true;
    botState.qrCode = null;
    botState.connectionStatus = 'READY';
    botState.loadingProgress = 100;
    botState.user = client.info?.pushname || client.info?.wid?.user || 'Connected';
    botState.phoneNumber = client.info?.wid?.user || null;
    botState.platform = client.info?.platform || null;
    botState.error = null;
    io.emit('state', botState);
    console.log(`🚀 WhatsApp Engine Connected and Ready! Logged in as: ${botState.user} (${botState.phoneNumber})`);
});

const BOT_START_TIME = Math.floor(Date.now() / 1000);

client.on('message_create', async (msg) => {
    // Ignore messages sent before bot startup
    if (msg.timestamp < BOT_START_TIME) return;

    // Ignore messages sent by ourselves
    if (msg.fromMe) return;

    // Ignore statuses, broadcast lists, and newsletters/channels
    if (msg.isStatus || msg.from === 'status@broadcast' || msg.from?.includes('@newsletter') || msg.from?.includes('broadcast')) return;

    // Filter out group messages without calling problematic msg.getChat()
    const isGroup = msg.isGroupMsg ||
                    msg.from?.endsWith('@g.us') ||
                    msg.to?.endsWith('@g.us') ||
                    Boolean(msg.author);
    if (isGroup) return;

    // Ignore empty or non-text messages
    if (!msg.body || typeof msg.body !== 'string' || !msg.body.trim()) return;

    try {
        await handleIncomingMessage(msg, botState, io);
    } catch (e) {
        console.error('Error handling incoming WhatsApp message:', e);
    }
});

app.get('/api/state', (req, res) => {
    if (client.info) {
        isReady = true;
        botState.connectionStatus = 'READY';
        botState.user = client.info.pushname || client.info.wid?.user || 'Connected';
        botState.phoneNumber = client.info.wid?.user || null;
        botState.platform = client.info.platform || null;
        botState.qrCode = null;
    }
    res.json(botState);
});

app.post('/api/state', async (req, res) => {
    const { status, customContext } = req.body;
    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (customContext !== undefined) updateData.customContext = customContext;
    await prisma.config.update({ where: { id: 1 }, data: updateData });
    botState = { ...botState, ...updateData };
    io.emit('state', botState);
    res.json(botState);
});

app.post('/api/logout', async (req, res) => {
    try {
        console.log('Logging out from WhatsApp Web and clearing session...');
        isReady = false;
        botState.connectionStatus = 'INITIALIZING';
        botState.qrCode = null;
        botState.user = null;
        botState.phoneNumber = null;
        io.emit('state', botState);
        res.json({ success: true });

        await client.logout().catch((e) => console.log('Logout notice:', e.message));
        setTimeout(async () => {
            try {
                console.log('Re-initializing client for fresh QR pairing...');
                await client.initialize();
            } catch (initErr) {
                console.error('Error re-initializing client:', initErr);
            }
        }, 2000);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/logs', async (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    try {
        // Validate and safely parse query parameters to prevent invalid Prisma invocation
        const parsedLimit = Number.parseInt(limit, 10);
        const parsedOffset = Number.parseInt(offset, 10);
        const take = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 100;
        const skip = Number.isInteger(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

        const logs = await prisma.conversationLog.findMany({
            take,
            skip,
            orderBy: { createdAt: 'desc' },
            include: {}
        });
        res.json(logs);
    } catch (e) {
        console.error('Error fetching conversation logs:', e);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// ── Feature #1: LLM Configuration ─────────────────────────────────────────────
app.get('/api/llm-config', async (req, res) => {
    try {
        const config = await getLLMConfig();
        // Never expose the raw API key to the frontend
        res.json({ ...config, apiKey: config.apiKey ? '••••••••' : '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/llm-config', async (req, res) => {
    try {
        const { provider, modelName, apiKey, baseUrl } = req.body;
        const updateData = {};
        if (provider) updateData.provider = provider;
        if (modelName) updateData.modelName = modelName;
        if (baseUrl !== undefined) updateData.baseUrl = baseUrl || null;
        // Only update apiKey if a real value was sent (not the masked '••••••••')
        if (apiKey && apiKey !== '••••••••') updateData.apiKey = apiKey;

        const existing = await prisma.lLMConfig.findUnique({ where: { id: 1 } });
        const updated = existing
            ? await prisma.lLMConfig.update({ where: { id: 1 }, data: updateData })
            : await prisma.lLMConfig.create({ data: { id: 1, provider: 'ollama', modelName: 'gemma4:latest', ...updateData } });
        invalidateLLMCache();
        res.json({ ...updated, apiKey: updated.apiKey ? '••••••••' : '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Feature #2: Calendar / Tasks Configuration ────────────────────────────────
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/calendar/google-auth/init', (req, res) => {
    try {
        res.json(getGoogleAuthUrl());
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.get('/api/calendar/google-auth/callback', async (req, res) => {
    const redirectUrl = new URL('http://localhost:3000/settings');

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
            : await prisma.calendarConfig.create({ data: { id: 1, calendarProvider: 'google', tasksProvider: 'google', ...updateData } });
        invalidateCalendarCache();
        res.json(updated);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Feature #3: Contact Policies ──────────────────────────────────────────────
app.get('/api/contact-policies', async (req, res) => {
    try { res.json(await getAllContactPolicies()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/contact-policies', async (req, res) => {
    try {
        const policy = await upsertContactPolicy(req.body);
        invalidatePolicyCache(req.body.contactId);
        res.json(policy);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/contact-policies/:contactId', async (req, res) => {
    try {
        await deleteContactPolicy(decodeURIComponent(req.params.contactId));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Feature #3: Approval Queue ────────────────────────────────────────────────
app.get('/api/approvals', async (req, res) => {
    try { res.json(await getPendingApprovals(req.query.status || 'pending')); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/approvals/:id/approve', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { editedResponse } = req.body;
        const approval = await approveApproval(id, editedResponse);
        // Dispatch the reply via WhatsApp immediately
        await dispatchApprovedReply(id, approval.aiDraft, client, io);
        res.json({ ok: true, approval });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/approvals/:id/reject', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const approval = await rejectApproval(id);
        res.json({ ok: true, approval });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/debug', async (req, res) => {
    try {
        const clientState = await client.getState().catch(e => e.message);
        const pageUrl = client.pupPage ? client.pupPage.url() : null;
        res.json({ botState, clientState, info: client.info || null, pageUrl });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/screenshot', async (req, res) => {
    try {
        if (!client.pupPage) return res.status(404).send('Page not available');
        const img = await client.pupPage.screenshot();
        res.contentType('image/png').send(img);
    } catch (e) { res.status(500).send(e.message); }
});

// ── Feature: Conversation Log Management ──────────────────────────────────────
app.post('/api/logs', async (req, res) => {
    try {
        const { chatId, senderName, message, response, type = 'text' } = req.body;

        if (!chatId || !senderName || !message) {
            return res.status(400).json({
                error: 'Missing required fields: chatId, senderName, message'
            });
        }

        const log = await prisma.conversationLog.create({
            data: {
                chatId,
                senderName,
                message,
                response,
                type,
                createdAt: new Date()
            }
        });

        res.status(201).json(log);
    } catch (e) {
        console.error('Error creating conversation log:', e);
        res.status(500).json({ error: 'Failed to create log' });
    }
});

io.on('connection', (socket) => socket.emit('state', botState));

// Initialize WhatsApp client with better error handling
async function initBot() {
    try {
        if (client.info) {
            // Bot already initialized, update state
            const readyInfo = client.info;
            console.log(`🚀 WhatsApp Engine Already Ready! Logged in as: ${readyInfo.pushname || readyInfo.wid?.user}`);
            io.emit('state', botState);
            return;
        }

        console.log('🔄 Initializing WhatsApp Web...');
        await client.initialize();

        // Wait a moment for initialization events to fire
        setTimeout(() => {
            if (client.info) {
                const info = client.info;
                console.log(`✅ WhatsApp Web Ready! Logged in as: ${info.pushname || info.wid?.user}`);
                io.emit('state', botState);
            } else {
                console.log('⚠️ WhatsApp initialization still in progress...');
            }
        }, 2000);
    } catch (err) {
        console.error('❌ WhatsApp initialization error:', err.message);
        if (botState.status === 'ON') {
            botState.connectionStatus = 'ERROR';
            botState.error = err.message;
            io.emit('state', botState);
        }
    }
}

initBot();
httpServer.listen(3001, async () => {
    console.log('✅ Core Engine HTTP Server running on port 3001');
    // Start bot initialization after server is ready
    await initBot();
});
