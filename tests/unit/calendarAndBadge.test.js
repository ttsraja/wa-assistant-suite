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

describe('D7/K6 — note fingerprint edge cases', () => {
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

    it('falls back to senderName when senderId missing', () => {
        const a = noteFingerprint({ senderName: 'Alice', noteType: 'NOTE', messageSummary: 'x' });
        const b = noteFingerprint({ senderId: 'alice', noteType: 'NOTE', messageSummary: 'x' });
        assert.equal(a, b);
    });

    it('defaults type to GENERAL_NOTE and unknown sender', () => {
        const fp = noteFingerprint({ messageSummary: 'hello' });
        assert.match(fp, /^unknown\|GENERAL_NOTE\|hello$/);
    });

    it('uses summary alias and empty summary', () => {
        assert.equal(
            noteFingerprint({ senderId: 's', noteType: 'N', summary: 'via summary' }),
            noteFingerprint({ senderId: 's', noteType: 'N', messageSummary: 'via summary' })
        );
        assert.match(noteFingerprint({ senderId: 's' }), /\|$/);
    });

    it('truncates very long summaries to 400 normalized chars', () => {
        const long = 'a'.repeat(1000);
        const fp = noteFingerprint({ senderId: 's', noteType: 'T', messageSummary: long });
        const parts = fp.split('|');
        assert.equal(parts[2].length, 400);
    });

    it('null/undefined args do not throw', () => {
        assert.doesNotThrow(() => noteFingerprint());
        assert.doesNotThrow(() => noteFingerprint(null));
        assert.doesNotThrow(() => noteFingerprint(undefined));
    });
});

describe('H/K1 — calendar badge follows selected provider (edge cases)', () => {
    const auth = {
        google: 'Not configured',
        macos: 'Available',
        windows: 'Unavailable',
    };

    it('H2 macOS selected + Google unauthenticated → Ready', () => {
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
        assert.equal(calendarBadgeOk({ google: 'Authenticated' }, 'google', 'google'), true);
    });

    it('mixed providers dual status all combinations', () => {
        assert.equal(calendarBadgeLabel(auth, 'macos', 'google'), 'Mac:OK · G:off');
        assert.equal(calendarBadgeOk(auth, 'macos', 'google'), false);
        assert.equal(
            calendarBadgeLabel({ google: 'Authenticated', macos: 'Available' }, 'google', 'macos'),
            'G:OK · Mac:OK'
        );
        assert.equal(
            calendarBadgeOk({ google: 'Authenticated', macos: 'Available' }, 'google', 'macos'),
            true
        );
        assert.equal(calendarBadgeLabel(auth, 'windows', 'macos'), 'Win:n/a · Mac:OK');
        assert.equal(calendarBadgeLabel(auth, 'macos', 'windows'), 'Mac:OK · Win:n/a');
    });

    it('windows unavailable and unknown status strings', () => {
        assert.equal(calendarBadgeLabel(auth, 'windows', 'windows'), 'Unavailable');
        assert.equal(calendarBadgeOk(auth, 'windows', 'windows'), false);
        assert.equal(calendarBadgeLabel({ macos: 'SomethingElse' }, 'macos', 'macos'), 'SomethingElse');
        assert.equal(calendarBadgeLabel({}, 'macos', 'macos'), '—');
        assert.equal(calendarBadgeLabel({}, 'google', 'google'), 'Not configured');
    });

    it('providerReady edge: missing authStatus, Authenticated on native', () => {
        assert.equal(providerReady(undefined, 'macos'), false);
        assert.equal(providerReady(null, 'google'), false);
        assert.equal(providerReady({ macos: 'Authenticated' }, 'macos'), true);
        assert.equal(providerReady({ google: 'Available' }, 'google'), false);
        assert.equal(providerReady({ google: 'Authenticated' }, 'google'), true);
    });

    it('defaults when keys omitted', () => {
        assert.equal(calendarBadgeLabel({ google: 'Not configured' }), 'Not configured');
        assert.equal(calendarBadgeOk({ google: 'Not configured' }), false);
    });

    it('unknown provider key uses generic OK/off in mixed mode', () => {
        const label = calendarBadgeLabel({ custom: 'Available' }, 'custom', 'google');
        assert.match(label, /OK|off/);
    });
});

describe('C1 — READY-only connected (full status matrix)', () => {
    const statuses = [
        'INITIALIZING',
        'SCAN_QR',
        'LOADING',
        'AUTHENTICATED',
        'READY',
        'ERROR',
        'AUTH_FAILURE',
        'DISCONNECTED',
        undefined,
        null,
        '',
    ];

    it('only READY is connected', () => {
        for (const s of statuses) {
            assert.equal(isWhatsAppConnected(s), s === 'READY', `status=${s}`);
        }
    });

    it('loading covers LOADING and AUTHENTICATED only', () => {
        assert.equal(isWhatsAppLoading('LOADING'), true);
        assert.equal(isWhatsAppLoading('AUTHENTICATED'), true);
        assert.equal(isWhatsAppLoading('READY'), false);
        assert.equal(isWhatsAppLoading('SCAN_QR'), false);
        assert.equal(isWhatsAppLoading('INITIALIZING'), false);
    });

    it('needsScan matrix with/without QR', () => {
        assert.equal(needsWhatsAppScan('SCAN_QR', null), true);
        assert.equal(needsWhatsAppScan('SCAN_QR', 'data:qr'), true);
        assert.equal(needsWhatsAppScan('AUTHENTICATED', 'data:qr'), false);
        assert.equal(needsWhatsAppScan('LOADING', 'data:qr'), false);
        assert.equal(needsWhatsAppScan('READY', 'data:qr'), false);
        assert.equal(needsWhatsAppScan('INITIALIZING', 'data:qr'), true);
        assert.equal(needsWhatsAppScan('INITIALIZING', null), false);
        assert.equal(needsWhatsAppScan('ERROR', 'qr'), true);
        assert.equal(needsWhatsAppScan('ERROR', ''), false);
        assert.equal(needsWhatsAppScan('DISCONNECTED', 'x'), true);
    });
});

describe('H11 — apiBase resolution edge cases', () => {
    it('preload __WA_API_BASE__ wins over location and env', () => {
        assert.equal(
            resolveApiBase({
                windowLike: {
                    __WA_API_BASE__: 'http://127.0.0.1:3456/',
                    location: {
                        protocol: 'http:',
                        hostname: 'localhost',
                        port: '3000',
                        origin: 'http://localhost:3000',
                    },
                },
                env: { NEXT_PUBLIC_API_BASE: 'http://should-not-win' },
            }),
            'http://127.0.0.1:3456'
        );
    });

    it('__WA_SAME_ORIGIN_API__ forces origin', () => {
        assert.equal(
            resolveApiBase({
                windowLike: {
                    __WA_SAME_ORIGIN_API__: true,
                    location: {
                        protocol: 'http:',
                        hostname: '127.0.0.1',
                        port: '9999',
                        origin: 'http://127.0.0.1:9999',
                    },
                },
                env: {},
            }),
            'http://127.0.0.1:9999'
        );
    });

    it('same-origin engine port 3001 and custom NEXT_PUBLIC_ENGINE_PORT', () => {
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
        assert.equal(
            resolveApiBase({
                windowLike: {
                    location: {
                        protocol: 'https:',
                        hostname: 'app.local',
                        port: '8443',
                        origin: 'https://app.local:8443',
                    },
                },
                env: { NEXT_PUBLIC_ENGINE_PORT: '8443' },
            }),
            'https://app.local:8443'
        );
    });

    it('loopback non-3000 uses origin; non-loopback :3000 falls through', () => {
        assert.equal(
            resolveApiBase({
                windowLike: {
                    location: {
                        protocol: 'http:',
                        hostname: 'localhost',
                        port: '4000',
                        origin: 'http://localhost:4000',
                    },
                },
                env: {},
            }),
            'http://localhost:4000'
        );
        assert.equal(
            resolveApiBase({
                windowLike: {
                    location: {
                        protocol: 'http:',
                        hostname: 'example.com',
                        port: '3000',
                        origin: 'http://example.com:3000',
                    },
                },
                env: {},
            }),
            'http://127.0.0.1:3001'
        );
    });

    it('Next dev :3000 falls back; NEXT_PUBLIC_API_BASE without window', () => {
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
        assert.equal(
            resolveApiBase({
                windowLike: null,
                env: { NEXT_PUBLIC_API_BASE: 'http://api.example:8080/' },
            }),
            'http://api.example:8080'
        );
        assert.equal(resolveApiBase({ windowLike: null, env: {} }), 'http://127.0.0.1:3001');
    });

    it('normalizeApiBase handles empty, null', () => {
        assert.equal(normalizeApiBase(''), '');
        assert.equal(normalizeApiBase(null), '');
        assert.equal(normalizeApiBase(undefined), '');
        assert.equal(normalizeApiBase('http://x/'), 'http://x');
        assert.equal(normalizeApiBase('http://x'), 'http://x');
    });

    it('file: protocol does not use same-origin branch', () => {
        assert.equal(
            resolveApiBase({
                windowLike: {
                    location: {
                        protocol: 'file:',
                        hostname: '',
                        port: '',
                        origin: 'file://',
                    },
                },
                env: {},
            }),
            'http://127.0.0.1:3001'
        );
    });
});
