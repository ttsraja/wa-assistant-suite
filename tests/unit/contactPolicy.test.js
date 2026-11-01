import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const modUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/services/contactPolicy.js')).href;
const { buildPolicyPromptOverlay, getRestrictedTopicMatches } = await import(modUrl);

describe('E — contact policy pure helpers (edge cases)', () => {
    it('E1 no policy / empty object → empty or no tone overlay', () => {
        assert.equal(buildPolicyPromptOverlay(null), '');
        assert.equal(buildPolicyPromptOverlay(undefined), '');
        assert.equal(buildPolicyPromptOverlay({}), '');
        assert.equal(buildPolicyPromptOverlay({ tone: '', infoLevel: 'full' }), '');
    });

    it('E2 tone overlays for formal/casual/tamil/tanglish; unknown tone ignored', () => {
        assert.match(buildPolicyPromptOverlay({ tone: 'formal' }), /formal/i);
        assert.match(buildPolicyPromptOverlay({ tone: 'formal' }), /TONE OVERRIDE/);
        assert.match(buildPolicyPromptOverlay({ tone: 'casual' }), /casual/i);
        assert.match(buildPolicyPromptOverlay({ tone: 'tamil' }), /Tamil|\u0ba4\u0bae\u0bbf\u0bb4\u0bcd/i);
        assert.match(buildPolicyPromptOverlay({ tone: 'tanglish' }), /Tanglish/i);
        assert.equal(buildPolicyPromptOverlay({ tone: 'auto' }), '');
        assert.equal(buildPolicyPromptOverlay({ tone: 'pirate' }), '');
    });

    it('E3 infoLevel limited and minimal; full is silent', () => {
        assert.match(buildPolicyPromptOverlay({ infoLevel: 'limited' }), /INFORMATION POLICY/);
        assert.match(buildPolicyPromptOverlay({ infoLevel: 'limited' }), /general availability/i);
        assert.match(buildPolicyPromptOverlay({ infoLevel: 'minimal' }), /extremely brief/i);
        assert.equal(buildPolicyPromptOverlay({ infoLevel: 'full' }), '');
        assert.equal(buildPolicyPromptOverlay({ infoLevel: 'unknown' }), '');
    });

    it('E4 invalid restrictedTopics JSON → empty matches and no overlay section', () => {
        assert.deepEqual(getRestrictedTopicMatches({ restrictedTopics: 'not-json' }, 'salary'), []);
        assert.deepEqual(getRestrictedTopicMatches({ restrictedTopics: null }, 'salary'), []);
        assert.deepEqual(getRestrictedTopicMatches(null, 'salary'), []);
        assert.deepEqual(getRestrictedTopicMatches({}, 'salary'), []);
        assert.equal(buildPolicyPromptOverlay({ restrictedTopics: '{bad' }), '');
        assert.equal(buildPolicyPromptOverlay({ restrictedTopics: '[]' }), '');
    });

    it('E5 topic match is case-insensitive substring; multi-match', () => {
        const policy = { restrictedTopics: JSON.stringify(['Salary', 'Project X', 'bonus']) };
        assert.deepEqual(getRestrictedTopicMatches(policy, 'what is the SALARY band?'), ['Salary']);
        assert.deepEqual(getRestrictedTopicMatches(policy, 'hello'), []);
        assert.deepEqual(getRestrictedTopicMatches(policy, 'project x timeline'), ['Project X']);
        assert.deepEqual(
            getRestrictedTopicMatches(policy, 'salary and BONUS please'),
            ['Salary', 'bonus']
        );
        assert.deepEqual(getRestrictedTopicMatches(policy, ''), []);
    });

    it('E5b empty topics array', () => {
        assert.deepEqual(getRestrictedTopicMatches({ restrictedTopics: '[]' }, 'anything'), []);
    });

    it('custom instructions: trim, blank ignored, combined with tone', () => {
        assert.equal(buildPolicyPromptOverlay({ customInstructions: '   ' }), '');
        assert.equal(buildPolicyPromptOverlay({ customInstructions: '' }), '');
        const o = buildPolicyPromptOverlay({
            tone: 'formal',
            customInstructions: '  Call him Sir only.  ',
        });
        assert.match(o, /TONE OVERRIDE/);
        assert.match(o, /SPECIAL INSTRUCTIONS/);
        assert.match(o, /Call him Sir only/);
    });

    it('combined policy stacks tone + info + topics + custom', () => {
        const o = buildPolicyPromptOverlay({
            tone: 'casual',
            infoLevel: 'limited',
            restrictedTopics: JSON.stringify(['secret']),
            customInstructions: 'Be brief.',
        });
        assert.match(o, /TONE OVERRIDE/);
        assert.match(o, /INFORMATION POLICY/);
        assert.match(o, /RESTRICTED TOPICS/);
        assert.match(o, /secret/);
        assert.match(o, /Be brief/);
    });
});
