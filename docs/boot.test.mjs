// Unit tests for the pure marker scanner in boot.js (node:test, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { askkScanMarkers } = require('./boot.js');

test('whole marker in one chunk', () => {
    const r = askkScanMarkers('', 'kernel log @ASKK:BOOT@ more log');
    assert.deepEqual(r.markers, [{ name: 'BOOT' }]);
    assert.equal(r.tailState, '');
});

test('multiple markers in one chunk', () => {
    const r = askkScanMarkers('', '@ASKK:BOOT@ x @ASKK:NET@ y @ASKK:HERMES@');
    assert.deepEqual(r.markers.map((m) => m.name), ['BOOT', 'NET', 'HERMES']);
});

test('marker split across two chunks', () => {
    let r = askkScanMarkers('', 'boot log @ASKK:RE');
    assert.deepEqual(r.markers, []);
    assert.equal(r.tailState, '@ASKK:RE');
    r = askkScanMarkers(r.tailState, 'ADY@ done');
    assert.deepEqual(r.markers, [{ name: 'READY' }]);
    assert.equal(r.tailState, '');
});

test('marker split inside the @ASKK: prefix', () => {
    let r = askkScanMarkers('', 'x@AS');
    assert.deepEqual(r.markers, []);
    assert.equal(r.tailState, '@AS');
    r = askkScanMarkers(r.tailState, 'KK:NET@');
    assert.deepEqual(r.markers, [{ name: 'NET' }]);
});

test('ERR payload extraction', () => {
    const r = askkScanMarkers('', '@ASKK:ERR:hermes exited 1@');
    assert.deepEqual(r.markers, [{ name: 'ERR', msg: 'hermes exited 1' }]);
});

test('ERR payload split across chunks', () => {
    let r = askkScanMarkers('', 'log @ASKK:ERR:oom ');
    assert.deepEqual(r.markers, []);
    r = askkScanMarkers(r.tailState, 'killed@ tail');
    assert.deepEqual(r.markers, [{ name: 'ERR', msg: 'oom killed' }]);
});

test('empty ERR message', () => {
    const r = askkScanMarkers('', '@ASKK:ERR:@');
    assert.deepEqual(r.markers, [{ name: 'ERR', msg: '' }]);
});

test('no false positive on a partial prefix', () => {
    const r = askkScanMarkers('', 'almost @ASKK:READ');
    assert.deepEqual(r.markers, []);
});

test('no false positive on a non-marker token', () => {
    const r = askkScanMarkers('', '@ASKK:READING@ and @ASKK:BOOTX junk');
    assert.deepEqual(r.markers, []);
});

test('unrelated @ text is not retained or matched', () => {
    const r = askkScanMarkers('', 'user@host:~$ echo hi');
    assert.deepEqual(r.markers, []);
    assert.equal(r.tailState, '');
});

test('marker after consumed marker in same chunk keeps clean tail', () => {
    const r = askkScanMarkers('', 'a@ASKK:BOOT@b@ASKK:N');
    assert.deepEqual(r.markers, [{ name: 'BOOT' }]);
    assert.equal(r.tailState, '@ASKK:N');
});

test('runaway partial is dropped past the cap', () => {
    let r = askkScanMarkers('', '@ASKK:ERR:' + 'x'.repeat(600));
    assert.equal(r.tailState, '');
    // and the scanner keeps working afterwards
    r = askkScanMarkers(r.tailState, '@ASKK:READY@');
    assert.deepEqual(r.markers, [{ name: 'READY' }]);
});
