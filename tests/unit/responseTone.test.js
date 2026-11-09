import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const toneUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/services/responseTone.js')).href;
const agentUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/services/ollamaAgent.js')).href;

const {
    RESPONSE_TONE_VALUES,
    normalizeResponseTone,
    buildGlobalToneOverlay,
    contactToneOverridesGlobal,
} = await import(toneUrl);
const { buildSystemPrompt, resolveOwnerName } = await import(agentUrl);

describe('Master Agent responseTone helpers', () => {
    it('exposes the canonical tone list', () => {
        assert.deepEqual([...RESPONSE_TONE_VALUES], [
            'auto', 'formal', 'casual', 'friendly', 'concise', 'tamil', 'tanglish',
        ]);
    });

    it('normalizeResponseTone defaults and rejects unknowns', () => {
        assert.equal(normalizeResponseTone(undefined), 'auto');
        assert.equal(normalizeResponseTone(null), 'auto');
        assert.equal(normalizeResponseTone(''), 'auto');
        assert.equal(normalizeResponseTone('  FORMAL  '), 'formal');
        assert.equal(normalizeResponseTone('pirate'), 'auto');
        assert.equal(normalizeResponseTone('concise'), 'concise');
        assert.equal(normalizeResponseTone('tamil'), 'tamil');
    });

    it('buildGlobalToneOverlay is empty for auto', () => {
        assert.equal(buildGlobalToneOverlay('auto'), '');
        assert.equal(buildGlobalToneOverlay(undefined), '');
        assert.equal(buildGlobalToneOverlay('nope'), '');
    });

    it('buildGlobalToneOverlay injects instruction for each non-auto tone', () => {
        for (const t of RESPONSE_TONE_VALUES.filter((x) => x !== 'auto')) {
            const o = buildGlobalToneOverlay(t);
            assert.match(o, /GLOBAL RESPONSE TONE/, t);
            assert.ok(o.length > 30, t);
        }
        assert.match(buildGlobalToneOverlay('formal'), /formal|professional/i);
        assert.match(buildGlobalToneOverlay('concise'), /short|brief|1–3|1-3/i);
        assert.match(buildGlobalToneOverlay('tamil'), /Tamil|தமிழ்/i);
        assert.match(buildGlobalToneOverlay('tanglish'), /Tanglish/i);
        assert.match(buildGlobalToneOverlay('friendly'), /warm|friendly/i);
        assert.match(buildGlobalToneOverlay('casual'), /casual/i);
    });

    it('contactToneOverridesGlobal only when contact tone is non-auto', () => {
        assert.equal(contactToneOverridesGlobal(null), false);
        assert.equal(contactToneOverridesGlobal({}), false);
        assert.equal(contactToneOverridesGlobal({ tone: 'auto' }), false);
        assert.equal(contactToneOverridesGlobal({ tone: '  ' }), false);
        assert.equal(contactToneOverridesGlobal({ tone: 'formal' }), true);
        assert.equal(contactToneOverridesGlobal({ tone: 'tamil' }), true);
    });
});

describe('buildSystemPrompt includes global tone for all vendors (text-only)', () => {
    it('auto tone has no GLOBAL RESPONSE TONE block', () => {
        const p = buildSystemPrompt('Alex', 'In a meeting', '', 'auto');
        assert.doesNotMatch(p, /GLOBAL RESPONSE TONE/);
        assert.match(p, /Mirror the sender/);
        assert.match(p, /In a meeting/);
        assert.match(p, /Alex/);
    });

    it('formal tone injects global block and keeps tool/calendar rules', () => {
        const p = buildSystemPrompt('Sam', 'Busy', '', 'formal', 'Alex');
        assert.match(p, /GLOBAL RESPONSE TONE/);
        assert.match(p, /formal|professional/i);
        assert.match(p, /getUpcomingSchedule/);
        assert.match(p, /recordUserNote/);
        assert.match(p, /NOT Alex/);
        assert.doesNotMatch(p, /Thanga/);
    });

    it('resolveOwnerName prefers config then WhatsApp pushname', () => {
        assert.equal(resolveOwnerName({ ownerName: 'Priya', user: 'Other' }), 'Priya');
        assert.equal(resolveOwnerName({ ownerName: '  ', user: 'Raja Kumar' }), 'Raja');
        assert.equal(resolveOwnerName({ ownerName: '', user: 'WhatsApp User' }), 'the owner');
        assert.equal(resolveOwnerName(null), 'the owner');
    });

    it('buildSystemPrompt uses owner name instead of hardcoded Thanga', () => {
        const p = buildSystemPrompt('Sam', 'Busy', '', 'auto', 'Jordan');
        assert.match(p, /Jordan's intelligent/);
        assert.match(p, /NOT Jordan/);
        assert.doesNotMatch(p, /Thanga/);
    });

    it('tamil tone adjusts language rule', () => {
        const p = buildSystemPrompt('Kumar', '', '', 'tamil');
        assert.match(p, /GLOBAL RESPONSE TONE/);
        assert.match(p, /Follow GLOBAL RESPONSE TONE for language/);
    });

    it('policy overlay still appends after global tone (contact override path)', () => {
        const policy = '\nTONE OVERRIDE (per-contact — overrides Master Agent global response tone): Be casual.';
        const p = buildSystemPrompt('Riya', 'ctx', policy, 'formal');
        assert.match(p, /GLOBAL RESPONSE TONE/);
        assert.match(p, /TONE OVERRIDE \(per-contact/);
        const globalIdx = p.indexOf('GLOBAL RESPONSE TONE');
        const overrideIdx = p.indexOf('TONE OVERRIDE');
        assert.ok(globalIdx >= 0 && overrideIdx > globalIdx);
    });

    it('unknown tone falls back like auto for overlay emptiness', () => {
        const p = buildSystemPrompt('X', '', '', 'not-a-tone');
        assert.doesNotMatch(p, /GLOBAL RESPONSE TONE/);
    });
});
