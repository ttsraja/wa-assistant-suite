import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
    startTestEngine,
    removeTempDataDir,
    jsonFetch,
    writeMinimalStaticUi,
} from '../helpers/engineHarness.js';

describe('B — engine HTTP contract (no WhatsApp)', () => {
    let engine;
    let staticDir;

    before(async () => {
        staticDir = mkdtempSync(path.join(tmpdir(), 'wa-static-'));
        writeMinimalStaticUi(staticDir);
        engine = await startTestEngine({ initWhatsApp: false, staticUiDir: staticDir });
    });

    after(async () => {
        if (engine) {
            await engine.stop();
            removeTempDataDir(engine.dataDir);
        }
        if (staticDir) rmSync(staticDir, { recursive: true, force: true });
    });

    it('B1 startEngine twice is idempotent', async () => {
        const { startEngine } = await import(
            new URL('../../apps/core-engine/src/server.js', import.meta.url).href
        );
        const second = await startEngine({
            dataDir: engine.dataDir,
            port: engine.port,
            host: '127.0.0.1',
            initWhatsApp: false,
            exitProcessOnSignal: false,
        });
        assert.equal(second.port, engine.port);
        assert.equal(second.baseUrl, engine.baseUrl);
    });

    it('B3 GET /api/state returns connection fields', async () => {
        const { ok, body } = await jsonFetch(engine.baseUrl, '/api/state');
        assert.equal(ok, true);
        assert.equal(typeof body.connectionStatus, 'string');
        assert.ok('status' in body);
        assert.ok('qrCode' in body);
    });

    it('B4 POST /api/state updates status and customContext', async () => {
        const { ok, body } = await jsonFetch(engine.baseUrl, '/api/state', {
            method: 'POST',
            body: JSON.stringify({ status: 'OFF', customContext: 'In tests' }),
        });
        assert.equal(ok, true);
        assert.equal(body.status, 'OFF');
        assert.equal(body.customContext, 'In tests');

        const again = await jsonFetch(engine.baseUrl, '/api/state');
        assert.equal(again.body.status, 'OFF');

        await jsonFetch(engine.baseUrl, '/api/state', {
            method: 'POST',
            body: JSON.stringify({ status: 'ON' }),
        });
    });

    
    it('B4b POST /api/state updates responseTone (Master Agent)', async () => {
        const { ok, body } = await jsonFetch(engine.baseUrl, '/api/state', {
            method: 'POST',
            body: JSON.stringify({ responseTone: 'formal' }),
        });
        assert.equal(ok, true);
        assert.equal(body.responseTone, 'formal');

        const again = await jsonFetch(engine.baseUrl, '/api/state');
        assert.equal(again.body.responseTone, 'formal');

        const bad = await jsonFetch(engine.baseUrl, '/api/state', {
            method: 'POST',
            body: JSON.stringify({ responseTone: 'pirate-mode' }),
        });
        assert.equal(bad.ok, true);
        assert.equal(bad.body.responseTone, 'auto');

        await jsonFetch(engine.baseUrl, '/api/state', {
            method: 'POST',
            body: JSON.stringify({ responseTone: 'auto' }),
        });
    });

    it('B5 logs create requires fields; list works', async () => {
        const bad = await jsonFetch(engine.baseUrl, '/api/logs', {
            method: 'POST',
            body: JSON.stringify({ message: 'only' }),
        });
        assert.equal(bad.status, 400);

        const created = await jsonFetch(engine.baseUrl, '/api/logs', {
            method: 'POST',
            body: JSON.stringify({
                chatId: 'test@c.us',
                senderName: 'Tester',
                message: 'hello',
                response: 'hi',
            }),
        });
        assert.equal(created.status, 201);
        assert.ok(created.body.id);

        const list = await jsonFetch(engine.baseUrl, '/api/logs?limit=10&offset=0');
        assert.equal(list.ok, true);
        assert.ok(Array.isArray(list.body));
        assert.ok(list.body.some((l) => l.chatId === 'test@c.us'));
    });

    it('B6 llm-config masks apiKey; placeholder not written', async () => {
        const set = await jsonFetch(engine.baseUrl, '/api/llm-config', {
            method: 'POST',
            body: JSON.stringify({
                provider: 'openai',
                modelName: 'gpt-test',
                apiKey: 'sk-secret-real',
            }),
        });
        assert.equal(set.ok, true);
        assert.equal(set.body.apiKey, '••••••••');
        assert.equal(set.body.provider, 'openai');

        const get = await jsonFetch(engine.baseUrl, '/api/llm-config');
        assert.equal(get.body.apiKey, '••••••••');
        assert.notEqual(get.body.apiKey, 'sk-secret-real');

        // Masked placeholder must not wipe key
        const keep = await jsonFetch(engine.baseUrl, '/api/llm-config', {
            method: 'POST',
            body: JSON.stringify({
                provider: 'openai',
                modelName: 'gpt-test-2',
                apiKey: '••••••••',
            }),
        });
        assert.equal(keep.ok, true);
        assert.equal(keep.body.apiKey, '••••••••');
        assert.equal(keep.body.modelName, 'gpt-test-2');
    });

    it('B7/B8 calendar-config authStatus + independent providers', async () => {
        const get = await jsonFetch(engine.baseUrl, '/api/calendar-config');
        assert.equal(get.ok, true);
        assert.ok(get.body.authStatus);
        assert.ok(['Authenticated', 'Not configured'].includes(get.body.authStatus.google));
        assert.ok(['Available', 'Unavailable'].includes(get.body.authStatus.macos));
        assert.ok(['Available', 'Unavailable'].includes(get.body.authStatus.windows));
        if (process.platform === 'darwin') {
            assert.equal(get.body.authStatus.macos, 'Available');
            assert.equal(get.body.authStatus.windows, 'Unavailable');
        }

        const post = await jsonFetch(engine.baseUrl, '/api/calendar-config', {
            method: 'POST',
            body: JSON.stringify({ calendarProvider: 'macos', tasksProvider: 'google' }),
        });
        assert.equal(post.ok, true);
        assert.equal(post.body.calendarProvider, 'macos');
        assert.equal(post.body.tasksProvider, 'google');

        const again = await jsonFetch(engine.baseUrl, '/api/calendar-config');
        assert.equal(again.body.calendarProvider, 'macos');
        assert.equal(again.body.tasksProvider, 'google');
        assert.ok(again.body.authStatus.macos);
    });

    it('B9 contact policies CRUD with encoded contactId', async () => {
        const contactId = '919900001111@c.us';
        const up = await jsonFetch(engine.baseUrl, '/api/contact-policies', {
            method: 'POST',
            body: JSON.stringify({
                contactId,
                displayName: 'Policy Test',
                tone: 'formal',
                infoLevel: 'limited',
                requiresApproval: true,
            }),
        });
        assert.equal(up.ok, true);
        assert.equal(up.body.contactId, contactId);
        assert.equal(up.body.requiresApproval, true);

        const list = await jsonFetch(engine.baseUrl, '/api/contact-policies');
        assert.ok(list.body.some((p) => p.contactId === contactId));

        const del = await jsonFetch(
            engine.baseUrl,
            `/api/contact-policies/${encodeURIComponent(contactId)}`,
            { method: 'DELETE' }
        );
        assert.equal(del.ok, true);

        const list2 = await jsonFetch(engine.baseUrl, '/api/contact-policies');
        assert.ok(!list2.body.some((p) => p.contactId === contactId));
    });

    it('B10 approvals list; missing approve id errors', async () => {
        const list = await jsonFetch(engine.baseUrl, '/api/approvals?status=pending');
        assert.equal(list.ok, true);
        assert.ok(Array.isArray(list.body));

        const bad = await jsonFetch(engine.baseUrl, '/api/approvals/999999/approve', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        assert.equal(bad.ok, false);
        assert.ok(bad.status >= 400);
    });

    it('B11 GET /api/system + debug paths', async () => {
        const sys = await jsonFetch(engine.baseUrl, '/api/system');
        assert.equal(sys.ok, true);
        assert.ok(sys.body.version);
        assert.equal(sys.body.dataDir, engine.dataDir);
        assert.ok(sys.body.durability?.preservesDatabase);
        assert.ok(String(sys.body.databaseFile).startsWith(engine.dataDir));

        const dbg = await jsonFetch(engine.baseUrl, '/api/debug');
        assert.equal(dbg.ok, true);
        assert.ok(dbg.body.botState);
        assert.equal(dbg.body.paths.dataDir, engine.dataDir);
    });

    it('B12 static UI mount serves / and /settings/', async () => {
        const home = await fetch(`${engine.baseUrl}/`);
        assert.equal(home.ok, true);
        const homeHtml = await home.text();
        assert.match(homeHtml, /Dashboard/);

        const settings = await fetch(`${engine.baseUrl}/settings/`);
        assert.equal(settings.ok, true);
        const settingsHtml = await settings.text();
        assert.match(settingsHtml, /Settings/);
    });

    it('J1 apiKey never returned raw', async () => {
        const get = await jsonFetch(engine.baseUrl, '/api/llm-config');
        if (get.body.apiKey) {
            assert.equal(get.body.apiKey, '••••••••');
        }
    });
});

describe('B2 — stop and restart engine', () => {
    it('stopEngine frees port; restart works', async () => {
        const first = await startTestEngine({ initWhatsApp: false });
        const port = first.port;
        const dataDir = first.dataDir;
        await first.stop();

        const second = await startTestEngine({ initWhatsApp: false, port, dataDir });
        try {
            const { ok, body } = await jsonFetch(second.baseUrl, '/api/state');
            assert.equal(ok, true);
            assert.ok(body.connectionStatus);
        } finally {
            await second.stop();
            removeTempDataDir(dataDir);
        }
    });
});
