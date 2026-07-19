// Unit tests for the pure capability gate in boot.js (node:test, no browser).
// Run: node --test docs/gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./boot.js'); // UMD-lite side effect: attaches AskkGateCore on globalThis
const gate = globalThis.AskkGateCore;

test('core is attached on globalThis', () => {
    assert.ok(gate, 'AskkGateCore missing');
    assert.equal(typeof gate.decide, 'function');
});

test('SAB present always boots, regardless of the other flags', () => {
    for (const reloaded of [false, true]) {
        for (const coi of [false, true]) {
            const v = gate.decide({ sab: true, reloaded, coi });
            assert.equal(v.action, 'boot', JSON.stringify({ reloaded, coi }));
            assert.equal(v.reason, 'sab-present');
        }
    }
});

test('no SAB, reload not yet done: wait for the SW dance (current behavior)', () => {
    for (const coi of [false, true]) {
        const v = gate.decide({ sab: false, reloaded: false, coi });
        assert.equal(v.action, 'reload-wait', 'coi=' + coi);
        assert.equal(v.reason, 'sw-installing');
    }
});

test('no SAB after the one-shot reload, not isolated: unsupported/no-isolation', () => {
    assert.deepEqual(gate.decide({ sab: false, reloaded: true, coi: false }),
        { action: 'unsupported', reason: 'no-isolation' });
});

test('no SAB after the one-shot reload, isolated: unsupported/no-sab', () => {
    assert.deepEqual(gate.decide({ sab: false, reloaded: true, coi: true }),
        { action: 'unsupported', reason: 'no-sab' });
});

test('missing/empty input degrades to reload-wait, never throws', () => {
    assert.equal(gate.decide().action, 'reload-wait');
    assert.equal(gate.decide({}).action, 'reload-wait');
});
