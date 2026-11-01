import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const pageSrc = path.join(REPO_ROOT, 'apps/web-control-center/app/page.js');
const settingsSrc = path.join(REPO_ROOT, 'apps/web-control-center/app/settings/page.js');
const runDev = path.join(REPO_ROOT, 'apps/desktop/run-dev.mjs');
const outIndex = path.join(REPO_ROOT, 'apps/web-control-center/out/index.html');

describe('T3 UI contract (source + optional export)', () => {
    it('H3 dashboard uses Calendar: label not Cal:', () => {
        const src = readFileSync(pageSrc, 'utf8');
        assert.match(src, /Calendar:\s*\{calProvider\}/);
        assert.doesNotMatch(src, /Cal:\s*\{calProvider\}/);
    });

    it('H1/K1 dashboard imports selected-provider badge helpers', () => {
        const src = readFileSync(pageSrc, 'utf8');
        assert.match(src, /calendarBadgeLabel/);
        assert.match(src, /from ["']\.\/lib\/calendarStatus["']/);
        assert.doesNotMatch(src, /authStatus\?\.google\s*\|\|/);
    });

    it('C1 dashboard uses READY-only connection helpers', () => {
        const src = readFileSync(pageSrc, 'utf8');
        assert.match(src, /isWhatsAppConnected/);
        assert.match(src, /from ["']\.\/lib\/connectionStatus["']/);
    });

    it('H5 settings gates Google OAuth on usesGoogle', () => {
        const src = readFileSync(settingsSrc, 'utf8');
        assert.match(src, /usesGoogle/);
        assert.match(src, /\{usesGoogle &&/);
    });

    it('I1/K5 desktop run-dev uses stock electron binary', () => {
        const src = readFileSync(runDev, 'utf8');
        assert.match(src, /require\(['"]electron['"]\)/);
        assert.match(src, /spawn\(bin,\s*\[\s*['"]\.['"]/);
        assert.doesNotMatch(src, /Electron\.app\/Contents\/MacOS\/Electron/);
    });

    it('Master Agent Response Tone control sits between mode and context', () => {
        const src = readFileSync(pageSrc, 'utf8');
        assert.match(src, /Response Tone/);
        assert.match(src, /responseTone/);
        assert.match(src, /RESPONSE_TONE_OPTIONS/);
        const modeIdx = src.indexOf('Autonomous Reply Mode');
        const toneIdx = src.indexOf('Response Tone');
        const ctxIdx = src.indexOf('Dynamic Prompt Context');
        assert.ok(modeIdx >= 0 && toneIdx > modeIdx && ctxIdx > toneIdx);
    });

it('H12 static export exists when built (soft if missing)', () => {
        if (!existsSync(outIndex)) {
            console.warn('skip: out/ not built — run npm run build:ui');
            return;
        }
        const html = readFileSync(outIndex, 'utf8');
        assert.ok(html.length > 50);
        assert.ok(existsSync(path.join(REPO_ROOT, 'apps/web-control-center/out/settings/index.html')));
    });
});
