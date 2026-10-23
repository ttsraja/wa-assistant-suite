import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const modUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/services/contactPolicy.js')).href;
const { buildPolicyPromptOverlay, getRestrictedTopicMatches } = await import(modUrl);

describe('E — contact policy pure helpers', () => {
    it('E1 no policy → empty overlay', () => {
        assert.equal(buildPolicyPromptOverlay(null), '');
        assert.equal(buildPolicyPromptOverlay(undefined), '');
    });

    it('E2 tone overlays for formal/casual/tamil/tanglish', () => {
        assert.match(buildPolicyPromptOverlay({ tone: 'formal' }), /formal/i);
        assert.match(buildPolicyPromptOverlay({ tone: 'casual' }), /casual/i);
        assert.match(buildPolicyPromptOverlay({ tone: 'tamil' }), /Tamil/i);
        assert.match(buildPolicyPromptOverlay({ tone: 'tanglish' }), /Tanglish/i);
        assert.equal(buildPolicyPromptOverlay({ tone: 'auto' }), '');
    });

    it('E3 infoLevel limited and minimal', () => {
        assert.match(buildPolicyPromptOverlay({ infoLevel: 'limited' }), /INFORMATION POLICY/);
        assert.match(buildPolicyPromptOverlay({ infoLevel: 'limited' }), /general availability/i);
        assert.match(buildPolicyPromptOverlay({ infoLevel: 'minimal' }), /extremely brief/i);
    });

    it('E4 invalid restrictedTopics JSON → empty matches', () => {
        assert.deepEqual(getRestrictedTopicMatches({ restrictedTopics: 'not-json' }, 'salary'), []);
        assert.equal(buildPolicyPromptOverlay({ restrictedTopics: '{bad' }), '');
    });

    it('E5 topic match is case-insensitive substring', () => {
        const policy = { restrictedTopics: JSON.stringify(['Salary', 'Project X']) };
        assert.deepEqual(getRestrictedTopicMatches(policy, 'what is the SALARY band?'), ['Salary']);
        assert.deepEqual(getRestrictedTopicMatches(policy, 'hello'), []);
        assert.deepEqual(getRestrictedTopicMatches(policy, 'project x timeline'), ['Project X']);
    });

    it('custom instructions append', () => {
        const o = buildPolicyPromptOverlay({ customInstructions: '  Call him Sir only.  ' });
        assert.match(o, /SPECIAL INSTRUCTIONS/);
        assert.match(o, /Call him Sir only/);
    });
});
