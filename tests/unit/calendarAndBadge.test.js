import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const calUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/services/calendarProvider.js')).href;
const badgeUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/web-control-center/app/lib/calendarStatus.js')).href;
const connUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/web-control-center/app/lib/connectionStatus.js')).href;
const apiUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/web-control-center/app/lib/apiBase.js')).href;

const { noteFingerprint } = await import(calUrl);
const { calendarBadgeLabel, calendarBadgeOk, providerReady } = await import(badgeUrl);
const { isWhatsAppConnected, isWhatsAppLoading, needsWhatsAppScan } = await import(connUrl);
const { resolveApiBase, normalizeApiBase } = await import(apiUrl);

describe('D7/K6 — note fingerprint', () => {
    it('normalizes whitespace and case for identical notes', () => {
        const a = noteFingerprint({
            senderId: '9199@c.us',
            noteType: 'urgent_message',
            messageSummary: '  Please call  back  ',
        });
        const b = noteFingerprint({
            senderId: '9199@c.us',
            noteType: 'urgent_message',
            messageSummary: 'please call back',
        });
        assert.equal(a, b);
    });

    it('different senders or types produce different fingerprints', () => {
        const a = noteFingerprint({ senderId: 'a@c.us', noteType: 'brief_note', messageSummary: 'hi' });
        const b = noteFingerprint({ senderId: 'b@c.us', noteType: 'brief_note', messageSummary: 'hi' });
        const c = noteFingerprint({ senderId: 'a@c.us', noteType: 'meeting_request', messageSummary: 'hi' });
        assert.notEqual(a, b);
        assert.notEqual(a, c);
    });
});

describe('H/K1 — calendar badge follows selected provider', () => {
    const auth = {
        google: 'Not configured',
        macos: 'Available',
        windows: 'Unavailable',
    };

    it('H2 macOS selected + Google unauthenticated → Ready, not Not configured', () => {
        assert.equal(calendarBadgeLabel(auth, 'macos', 'macos'), 'Ready');
        assert.equal(calendarBadgeOk(auth, 'macos', 'macos'), true);
        assert.equal(providerReady(auth, 'macos'), true);
        assert.equal(providerReady(auth, 'google'), false);
    });

    it('H1 Google selected shows Auth OK only when Authenticated', () => {
        assert.equal(calendarBadgeLabel(auth, 'google', 'google'), 'Not configured');
        assert.equal(
            calendarBadgeLabel({ ...auth, google: 'Authenticated' }, 'google', 'google'),
            'Auth OK'
        );
    });

    it('mixed providers dual status', () => {
        assert.equal(calendarBadgeLabel(auth, 'macos', 'google'), 'Mac:OK · G:off');
        assert.equal(calendarBadgeOk(auth, 'macos', 'google'), false);
    });

    it('windows unavailable', () => {
        assert.equal(calendarBadgeLabel(auth, 'windows', 'windows'), 'Unavailable');
        assert.equal(calendarBadgeOk(auth, 'windows', 'windows'), false);
    });
});

describe('C1 — READY-only connected', () => {
    it('only READY is connected', () => {
        assert.equal(isWhatsAppConnected('READY'), true);
        assert.equal(isWhatsAppConnected('AUTHENTICATED'), false);
        assert.equal(isWhatsAppConnected('SCAN_QR'), false);
        assert.equal(isWhatsAppConnected('LOADING'), false);
    });

    it('AUTHENTICATED counts as loading not scan', () => {
        assert.equal(isWhatsAppLoading('AUTHENTICATED'), true);
        assert.equal(needsWhatsAppScan('AUTHENTICATED', 'data:qr'), false);
        assert.equal(needsWhatsAppScan('SCAN_QR', 'data:qr'), true);
        assert.equal(needsWhatsAppScan('INITIALIZING', 'data:qr'), true);
    });
});

describe('H11 — apiBase resolution', () => {
    it('preload __WA_API_BASE__ wins', () => {
        assert.equal(
            resolveApiBase({
                windowLike: { __WA_API_BASE__: 'http://127.0.0.1:3456/', location: {} },
                env: {},
            }),
            'http://127.0.0.1:3456'
        );
    });

    it('same-origin engine port 3001', () => {
        assert.equal(
            resolveApiBase({
                windowLike: {
                    location: {
                        protocol: 'http:',
                        hostname: '127.0.0.1',
                        port: '3001',
                        origin: 'http://127.0.0.1:3001',
                    },
                },
                env: {},
            }),
            'http://127.0.0.1:3001'
        );
    });

    it('Next dev :3000 falls back to 3001', () => {
        assert.equal(
            resolveApiBase({
                windowLike: {
                    location: {
                        protocol: 'http:',
                        hostname: 'localhost',
                        port: '3000',
                        origin: 'http://localhost:3000',
                    },
                },
                env: {},
            }),
            'http://127.0.0.1:3001'
        );
    });

    it('normalize strips trailing slash', () => {
        assert.equal(normalizeApiBase('http://x/'), 'http://x');
    });
});
