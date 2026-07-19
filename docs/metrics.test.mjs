// Unit tests for the pure metrics core in boot.js (node:test, no browser).
// Run: node --test docs/metrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./boot.js'); // UMD-lite side effect: attaches AskkMetricsCore on globalThis
const core = globalThis.AskkMetricsCore;

test('core is attached on globalThis', () => {
    assert.ok(core, 'AskkMetricsCore missing');
});

test('mark/phase math with a fake clock', () => {
    let t = 0;
    const tl = core.createTimeline(() => t);
    tl.mark('a');           // 0
    t = 100; tl.mark('b');  // 100
    t = 250; tl.mark('b');  // ignored — first occurrence wins
    t = 400; tl.mark('c');  // 400
    assert.equal(tl.phase('a-b', 'a', 'b'), 100);
    assert.equal(tl.phase('b-c', 'b', 'c'), 300);
    assert.equal(tl.marks.b, 100);
});

test('phase with a missing mark is null and records nothing', () => {
    const tl = core.createTimeline(() => 1);
    tl.mark('a');
    assert.equal(tl.phase('nope', 'a', 'missing'), null);
    assert.equal(tl.phase('nope', 'missing', 'a'), null);
    assert.deepEqual(tl.table(), []);
});

test('table shape stable: ordered {name, ms} and {name, value} rows, copied', () => {
    let t = 0;
    const tl = core.createTimeline(() => t);
    tl.mark('x');
    t = 12.34; tl.mark('y');
    tl.phase('x-y', 'x', 'y');
    tl.note('gz-bytes', 1234);
    tl.note('guest:python311 (guest-s)', 42);
    assert.deepEqual(tl.table(), [
        { name: 'x-y', ms: 12.3 },
        { name: 'gz-bytes', value: 1234 },
        { name: 'guest:python311 (guest-s)', value: 42 },
    ]);
    tl.table().push({ name: 'junk' }); // table() is a copy
    assert.equal(tl.table().length, 3);
});

test('parseGuestMetric accepts @ASKK:T:x=y@ lines', () => {
    assert.deepEqual(core.parseGuestMetric('@ASKK:T:python311=42@'),
        { phase: 'python311', seconds: 42 });
    assert.deepEqual(core.parseGuestMetric('boot log @ASKK:T:net.dhcp=1.5@ tail\r'),
        { phase: 'net.dhcp', seconds: 1.5 });
});

test('parseGuestMetric rejects non-metric lines and partial junk', () => {
    for (const line of [
        '@ASKK:BOOT@',
        '@ASKK:READY@',
        '@ASKK:T:python311=42',   // unterminated
        'ASKK:T:python311=42@',   // missing leading @
        '@ASKK:T:=42@',           // empty phase
        '@ASKK:T:x=@',            // empty value
        '@ASKK:T:x=abc@',         // non-numeric value
        '@ASKK:T:x@',             // no assignment
        'user@host:~$ echo hi',
        '',
    ]) assert.equal(core.parseGuestMetric(line), null, JSON.stringify(line));
});
