import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pathToFileURL } from 'url';
import { REPO_ROOT } from '../helpers/engineHarness.js';

const modUrl = pathToFileURL(path.join(REPO_ROOT, 'apps/core-engine/src/services/llmProvider.js')).href;
const { parseToolArgs, toFunctionResponseObject } = await import(modUrl);

describe('F — LLM pure helpers (parseToolArgs / toFunctionResponseObject)', () => {
    it('parseToolArgs: null/undefined → {}', () => {
        assert.deepEqual(parseToolArgs(null), {});
        assert.deepEqual(parseToolArgs(undefined), {});
    });

    it('parseToolArgs: object passed through (including arrays)', () => {
        const obj = { a: 1 };
        assert.equal(parseToolArgs(obj), obj);
        const arr = [1, 2];
        assert.equal(parseToolArgs(arr), arr);
    });

    it('parseToolArgs: valid JSON string', () => {
        assert.deepEqual(parseToolArgs('{"x":2}'), { x: 2 });
        assert.deepEqual(parseToolArgs('[]'), []);
    });

    it('parseToolArgs: invalid JSON string → {}', () => {
        assert.deepEqual(parseToolArgs('{bad'), {});
        assert.deepEqual(parseToolArgs('not-json'), {});
        assert.deepEqual(parseToolArgs(''), {});
    });

    it('parseToolArgs: non-string non-object → {}', () => {
        assert.deepEqual(parseToolArgs(42), {});
        assert.deepEqual(parseToolArgs(true), {});
    });

    it('toFunctionResponseObject: objects pass through', () => {
        const o = { result: 'ok' };
        assert.equal(toFunctionResponseObject(o), o);
        assert.deepEqual(toFunctionResponseObject([1]), [1]);
    });

    it('toFunctionResponseObject: JSON object string unwraps', () => {
        assert.deepEqual(toFunctionResponseObject('{"a":1}'), { a: 1 });
    });

    it('toFunctionResponseObject: JSON primitive wraps in result', () => {
        assert.deepEqual(toFunctionResponseObject('"hi"'), { result: 'hi' });
        assert.deepEqual(toFunctionResponseObject('12'), { result: 12 });
        assert.deepEqual(toFunctionResponseObject('true'), { result: true });
        assert.deepEqual(toFunctionResponseObject('null'), { result: null });
    });

    it('toFunctionResponseObject: plain string and invalid JSON', () => {
        assert.deepEqual(toFunctionResponseObject('hello'), { result: 'hello' });
        assert.deepEqual(toFunctionResponseObject('{bad'), { result: '{bad' });
    });

    it('toFunctionResponseObject: null/undefined/number', () => {
        assert.deepEqual(toFunctionResponseObject(null), { result: null });
        assert.deepEqual(toFunctionResponseObject(undefined), { result: null });
        assert.deepEqual(toFunctionResponseObject(0), { result: 0 });
    });
});
