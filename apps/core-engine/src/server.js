import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { handleIncomingMessage } from './services/ollamaAgent.js';
import fs from 'fs';

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
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {})
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
    const logs = await prisma.conversationLog.findMany({ take: 50, orderBy: { createdAt: 'desc' } });
    res.json(logs);
});
app.get('/api/debug', async (req, res) => {
    try {
        const clientState = await client.getState().catch(e => e.message);
        const pageUrl = client.pupPage ? client.pupPage.url() : null;
        res.json({
            botState,
            clientState,
            info: client.info || null,
            pageUrl
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/screenshot', async (req, res) => {
    try {
        if (!client.pupPage) return res.status(404).send("Page not available");
        const img = await client.pupPage.screenshot();
        res.contentType('image/png').send(img);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

io.on('connection', (socket) => socket.emit('state', botState));

client.initialize();
httpServer.listen(3001, () => console.log('Core Engine running on port 3001'));