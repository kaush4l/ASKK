// ASKK boot runtime (unit 2) — Eliza's inline index.html boot logic, extracted
// into a module. Owns: chunked image fetch + gunzip, pty creation, VM worker
// handoff, boot-marker watch, progress driving.
//
// Page seam (CONTRACTS.md):
//   window.AskkBoot.start({terminal, getBackend, onStatus(pct, msg), onMarker(name)})
// Depends on page globals loaded by index.html (unit 5): openpty / Termios /
// TtyServer + termios flag constants (vendored xterm-pty@0.9.4), and
// window.AskkNet.attach(vmWorker, getBackend) (unit 3).
//
// UMD-lite: attaches to globalThis for the page, exports for node tests.

// Pure metrics core — no DOM/worker APIs, attached on globalThis so
// node:test can load this file directly (docs/metrics.test.mjs). Wall-clock
// ms (performance.now) and guest-reported seconds (@ASKK:T:x=y@, guest
// clock runs several× faster than real time) are NEVER mixed: phases are
// {name, ms}, guest timings are {name, value} notes labeled guest-s.
(function (g) {
    'use strict';

    function createTimeline(now) {
        var marks = {}; // name -> t of FIRST occurrence
        var rows = [];  // ordered {name, ms} | {name, value}
        return {
            marks: marks,
            mark: function (name) {
                if (marks[name] === undefined) marks[name] = now();
                return marks[name];
            },
            phase: function (name, fromMark, toMark) {
                var a = marks[fromMark], b = marks[toMark];
                if (a === undefined || b === undefined) return null;
                var ms = Math.round((b - a) * 10) / 10;
                rows.push({ name: name, ms: ms });
                return ms;
            },
            note: function (name, value) {
                rows.push({ name: name, value: value });
            },
            table: function () {
                return rows.slice();
            },
        };
    }

    // '@ASKK:T:<phase>=<seconds>@' (CONTRACTS.md metric markers) within a
    // console line -> {phase, seconds}; null for anything else, including
    // unterminated/partial junk.
    function parseGuestMetric(line) {
        var m = /@ASKK:T:([A-Za-z0-9_.-]+)=([0-9]+(?:\.[0-9]+)?)@/.exec(String(line));
        return m ? { phase: m[1], seconds: Number(m[2]) } : null;
    }

    g.AskkMetricsCore = { createTimeline: createTimeline, parseGuestMetric: parseGuestMetric };
})(typeof globalThis !== 'undefined' ? globalThis : self);

// Pure capability gate (AskkMetricsCore pattern — no DOM, node-testable via
// docs/gate.test.mjs). The page calls decide() BEFORE the heavy download:
//   sab      — typeof SharedArrayBuffer !== 'undefined'
//   reloaded — the SW's one-shot reload already happened (sessionStorage
//              'askk-sw-reloaded', set by askk-sw.js's window half)
//   coi      — window.crossOriginIsolated
// Verdicts: 'boot' (SAB is up), 'reload-wait' (the SW install + one-shot
// reload dance is still pending — keep the current spinner path), or
// 'unsupported' with reason 'no-isolation' (COOP/COEP never came up) /
// 'no-sab' (isolated, yet SAB still missing) for an honest failure panel
// instead of an infinite spinner.
(function (g) {
    'use strict';

    function decide(caps) {
        caps = caps || {};
        if (caps.sab) return { action: 'boot', reason: 'sab-present' };
        if (!caps.reloaded) return { action: 'reload-wait', reason: 'sw-installing' };
        return caps.coi
            ? { action: 'unsupported', reason: 'no-sab' }
            : { action: 'unsupported', reason: 'no-isolation' };
    }

    g.AskkGateCore = { decide: decide };
})(typeof globalThis !== 'undefined' ? globalThis : self);

(function (g) {
    'use strict';

    var DEFAULT_MODEL = 'gemma-4-12B-it-qat-mxfp8'; // CONTRACTS.md default
    var MARKER_PCT = { BOOT: 70, NET: 80, HERMES: 90, READY: 100 };
    var MARKER_MSG = {
        BOOT: 'guest userspace up — bringing up network…',
        NET: 'guest network up — starting hermes…',
        HERMES: 'hermes starting…',
        READY: 'ready — guest shell live',
    };
    var MAX_TAIL = 512;

    // Pure marker scanner. Feed successive output chunks; markers survive
    // being split across chunks via the returned tailState (carry it between
    // calls). Returns {tailState, markers:[{name} | {name:'ERR', msg}]}.
    // ponytail: assumes the guest prints each marker contiguously (printf on a
    // line-buffered console) — ANSI escapes interleaved *inside* a marker
    // would defeat it; strip escapes pre-scan if that ever shows up.
    function askkScanMarkers(tailState, chunk) {
        var s = (tailState || '') + String(chunk);
        var re = /@ASKK:(BOOT|NET|HERMES|READY|ERR:([^@]*))@/g;
        var markers = [];
        var lastEnd = 0;
        var m;
        while ((m = re.exec(s)) !== null) {
            markers.push(m[2] !== undefined ? { name: 'ERR', msg: m[2] } : { name: m[1] });
            lastEnd = re.lastIndex;
        }
        // Keep only a suffix that could still become a marker: the last '@'
        // whose remainder is a prefix of '@ASKK:<body>' with no closing '@'.
        var rest = s.slice(lastEnd);
        var tail = '';
        var at = rest.lastIndexOf('@');
        if (at !== -1) {
            var cand = rest.slice(at);
            if ('@ASKK:'.startsWith(cand) ||
                (cand.slice(0, 6) === '@ASKK:' && cand.indexOf('@', 1) === -1)) {
                tail = cand;
            }
        }
        if (tail.length > MAX_TAIL) tail = ''; // runaway non-marker after '@ASKK:' — drop
        return { tailState: tail, markers: markers };
    }

    // Anti-throttle (Eliza pattern): hidden tabs clamp window timers to as
    // little as one tick per minute, which starves the VM's I/O polling (the
    // net stack and tty waits run on this thread). Dedicated-worker timers
    // are exempt, so route all page timers through timer-worker.js.
    var timersPatched = false;
    function patchTimers() {
        if (timersPatched) return;
        timersPatched = true;
        var w = new Worker('./timer-worker.js');
        var cbs = new Map();
        var seq = 0;
        w.onmessage = function (e) {
            var c = cbs.get(e.data);
            if (!c) return;
            if (!c.repeat) cbs.delete(e.data);
            c.fn.apply(null, c.args);
        };
        var mk = function (repeat) {
            return function (fn, ms) {
                var args = Array.prototype.slice.call(arguments, 2);
                var id = ++seq;
                cbs.set(id, { fn: typeof fn === 'string' ? new Function(fn) : fn, args: args, repeat: repeat });
                w.postMessage({ id: id, ms: ms || 0, repeat: repeat });
                return id;
            };
        };
        var clr = function (id) { cbs.delete(id); w.postMessage({ clear: id }); };
        g.setTimeout = mk(false);
        g.setInterval = mk(true);
        g.clearTimeout = clr;
        g.clearInterval = clr;
    }

    // Chunk fetch with the askk-image cache (same store the SW uses). The
    // very first load can start before the SW controls the page — its
    // cache-first chunk route never sees those fetches — so the page does
    // the same cache-first dance itself. Controlled page: plain fetch, the
    // SW route owns the caching. Any cache failure degrades to network.
    async function cachedChunkFetch(url) {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker &&
            navigator.serviceWorker.controller) return fetch(url);
        var cache = null;
        try { cache = await caches.open('askk-image'); } catch (e) {}
        if (cache) {
            var hit = await cache.match(url);
            if (hit) return hit;
        }
        var resp = await fetch(url);
        if (cache && resp.ok) {
            try {
                await cache.put(url, resp.clone());
                var abs = new URL(url, g.location.href);
                var keys = await cache.keys();
                for (var i = 0; i < keys.length; i++) {
                    var ku = new URL(keys[i].url);
                    if (ku.pathname === abs.pathname && ku.search !== abs.search) {
                        await cache.delete(keys[i]);
                    }
                }
            } catch (e) { /* quota — network still served the boot */ }
        }
        return resp;
    }

    // Fetch the gzipped image chunks (kept <100MB each for GitHub), stream
    // them through one DecompressionStream into a preallocated buffer that
    // gets transferred (zero-copy) to the VM worker. Download drives 0-60%.
    async function loadImage(status, tl) {
        status(2, 'loading image manifest…');
        var mf = await (await fetch('./wasm/manifest.json', { cache: 'no-store' })).json();
        tl.mark('manifest');
        tl.phase('manifest-fetch', 'start', 'manifest');
        var raw = new Uint8Array(mf.raw_total);
        var rawOff = 0;
        var ds = new DecompressionStream('gzip');
        var drained = (async function () {
            var r = ds.readable.getReader();
            for (;;) {
                var res = await r.read();
                if (res.done) break;
                if (rawOff + res.value.length > raw.length) throw new Error('image larger than manifest raw_total');
                raw.set(res.value, rawOff);
                rawOff += res.value.length;
            }
        })();
        var w = ds.writable.getWriter();
        var got = 0;
        var totalMB = Math.round(mf.gz_total / 1048576);
        for (var pi = 0; pi < mf.parts.length; pi++) {
            var name = mf.parts[pi];
            // gz_total in the query string busts browser/CDN caches whenever
            // the image content changes (part filenames stay the same).
            var resp = await cachedChunkFetch('./wasm/' + name + '?g=' + mf.gz_total);
            if (!resp.ok) throw new Error(name + ': HTTP ' + resp.status);
            var rd = resp.body.getReader();
            for (;;) {
                var c = await rd.read();
                if (c.done) break;
                got += c.value.length;
                await w.write(c.value);
                status(Math.round(got / mf.gz_total * 60),
                       'downloading ASKK image — ' + Math.round(got / 1048576) + ' / ' +
                       totalMB + ' MB (' + Math.round(got / mf.gz_total * 100) + '%)');
            }
        }
        tl.mark('download');
        var dlMs = tl.phase('download', 'manifest', 'download');
        tl.note('gz-bytes', got);
        if (dlMs > 0) tl.note('download-MB/s', Math.round(got / 1048576 / (dlMs / 1000) * 10) / 10);
        await w.close();
        await drained;
        if (rawOff !== raw.length) throw new Error('image truncated: ' + rawOff + ' of ' + raw.length + ' bytes');
        // Gunzip streams DURING download; this phase is only the tail drain.
        tl.mark('unpack');
        tl.phase('unpack-tail', 'download', 'unpack');
        tl.note('raw-bytes', rawOff);
        status(62, 'image unpacked (' + Math.round(mf.raw_total / 1048576) + ' MB) — starting VM…');
        return raw.buffer;
    }

    // The guest env only varies in the model name; it rides the worker URL
    // (Eliza pattern — worker.js reads it via getQueryParam).
    function modelName(getBackend) {
        try {
            var q = new URLSearchParams(g.location.search).get('model');
            if (q) return q;
        } catch (e) {}
        try {
            var b = getBackend && getBackend();
            if (b && typeof b === 'object' && b.model) return String(b.model);
        } catch (e) {}
        try {
            var s = JSON.parse(g.localStorage.getItem('askk-llm'));
            if (s && s.model) return String(s.model);
        } catch (e) {}
        return DEFAULT_MODEL;
    }

    function latin1(u8) {
        var out = '';
        for (var i = 0; i < u8.length; i++) out += String.fromCharCode(u8[i]);
        return out;
    }

    async function start(opts) {
        var terminal = opts.terminal;
        var getBackend = opts.getBackend;
        var onStatus = opts.onStatus || function () {};
        var onMarker = opts.onMarker || function () {};
        // Metrics timeline — pure observer, never gates progress/status/
        // watchdog. Live handle for the console: window.__askkMetrics.
        var tl = g.AskkMetricsCore.createTimeline(function () { return performance.now(); });
        g.__askkMetrics = tl;
        tl.mark('start');
        // pct is monotonic for progress values: HERMES(90) may legitimately
        // arrive minutes after READY(100) — a bar that runs backwards reads
        // as a crash. pct 0 passes through (error/reset signal).
        var maxPct = 0;
        var status = function (pct, msg) {
            if (typeof pct === 'number' && pct > 0) {
                if (pct < maxPct) pct = maxPct; else maxPct = pct;
            }
            try { onStatus(pct, msg); } catch (e) {}
        };

        if (typeof SharedArrayBuffer === 'undefined') {
            status(0, 'SharedArrayBuffer unavailable — reload once (service worker installing), or use a COOP/COEP host.');
            throw new Error('SharedArrayBuffer unavailable');
        }
        if (!g.AskkNet || typeof g.AskkNet.attach !== 'function') {
            // Fail before the multi-hundred-MB download, not after it.
            status(0, 'network stack missing — stack.js (AskkNet) not loaded');
            throw new Error('AskkNet.attach unavailable');
        }

        patchTimers();
        if (typeof BroadcastChannel !== 'undefined') {
            g.__dbg = g.__dbg || [];
            new BroadcastChannel('askk-dbg').onmessage = function (e) { g.__dbg.push(e.data); };
        }

        // Page-side memory sampling (Chrome-only performance.memory; other
        // engines simply skip this). IMPORTANT SCOPE NOTE: the VM's wasm
        // linear memory — the 1024MB guest RAM that dominates the tab's real
        // cost — lives in the VM WORKER and is NOT visible to page JS heap;
        // this number is page-side only. (measureUserAgentSpecificMemory
        // would see more but is unavailable in embedded contexts, so it is
        // deliberately not used.)
        // Live handle: window.__askkMetrics.memory = {jsHeapMB, samples}.
        var sampleHeap = null;
        if (typeof performance !== 'undefined' && performance.memory) {
            var mem = { jsHeapMB: 0, samples: [] };
            tl.memory = mem;
            sampleHeap = function () {
                var mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
                mem.jsHeapMB = mb;
                mem.samples.push({ t: Math.round(performance.now()), mb: mb });
                // ponytail: cap ~4h of 30s samples; a ring buffer is overkill
                if (mem.samples.length > 480) mem.samples.shift();
                return mb;
            };
            sampleHeap();
            setInterval(sampleHeap, 30000); // patched timer — hidden-tab safe
        }

        // Marker watch: wrap terminal.write BEFORE loadAddon(master) so every
        // chunk the pty renders is scanned, even when a marker straddles two
        // flushes. No prompt scraping, no auto-typing — markers only.
        var scanTail = '';
        var bootDone = false;
        var handleMarker = function (mk) {
            if (mk.name === 'READY') bootDone = true;
            if (mk.name !== 'ERR' && tl.marks[mk.name] === undefined) {
                tl.mark(mk.name);
                tl.phase('to-' + mk.name, 'start', mk.name);
                if (mk.name === 'READY') {
                    if (sampleHeap) tl.note('page-js-heap-MB', sampleHeap());
                    try { console.table(tl.table()); } catch (e) {}
                }
            }
            try { onMarker(mk.name === 'ERR' ? 'ERR:' + mk.msg : mk.name); } catch (e) {}
            if (mk.name === 'ERR') {
                status(0, 'guest boot error: ' + mk.msg);
            } else if (MARKER_PCT[mk.name] !== undefined) {
                var msg = MARKER_MSG[mk.name];
                if (mk.name === 'READY' && sampleHeap) {
                    // page heap only — the 1024MB guest RAM sits in the worker
                    msg += ' · page JS heap ' + tl.memory.jsHeapMB + ' MB';
                }
                status(MARKER_PCT[mk.name], msg);
            }
        };
        var write0 = terminal.write.bind(terminal);
        var lastOutputAt = 0;
        // Guest '@ASKK:T:x=y@' metric markers are line-printed (CONTRACTS.md)
        // and NOT matched by askkScanMarkers — buffer to whole lines and run
        // the pure parser. Values are guest-seconds (guest clock, several×
        // faster than real) so they go in as notes, never as wall-clock ms.
        var metricLineBuf = '';
        terminal.write = function (data, cb) {
            lastOutputAt = Date.now();
            try {
                var text = typeof data === 'string' ? data : latin1(data);
                var r = askkScanMarkers(scanTail, text);
                scanTail = r.tailState;
                for (var i = 0; i < r.markers.length; i++) handleMarker(r.markers[i]);
                metricLineBuf += text;
                var nl;
                while ((nl = metricLineBuf.indexOf('\n')) !== -1) {
                    var gm = g.AskkMetricsCore.parseGuestMetric(metricLineBuf.slice(0, nl));
                    if (gm) tl.note('guest:' + gm.phase + ' (guest-s)', gm.seconds);
                    metricLineBuf = metricLineBuf.slice(nl + 1);
                }
                if (metricLineBuf.length > MAX_TAIL) metricLineBuf = metricLineBuf.slice(-MAX_TAIL);
            } catch (e) {}
            return write0(data, cb);
        };

        var imagedata;
        try {
            imagedata = await loadImage(status, tl);
        } catch (err) {
            status(0, 'FAILED to load the ASKK image: ' + err);
            throw err;
        }

        // pty in raw mode — the guest console owns the line discipline.
        var pty = openpty();
        var master = pty.master;
        var slave = pty.slave;
        var t = slave.ioctl('TCGETS');
        t.iflag &= ~(ISTRIP | INLCR | IGNCR | ICRNL | IXON);
        t.oflag &= ~OPOST;
        t.lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
        slave.ioctl('TCSETS', new Termios(t.iflag, t.oflag, t.cflag, t.lflag, t.cc));
        terminal.loadAddon(master);

        // Forward page query params to the worker (Eliza pattern — keeps debug
        // switches like ?clock=snap alive); net + model are pinned here.
        var wq = new URLSearchParams(g.location ? g.location.search : '');
        wq.delete('backend');
        // Default net mode is the browser fetch-proxy; an explicit ?net=…
        // (e.g. net=none) is honored for debugging the handshake.
        if (!wq.get('net')) wq.set('net', 'browser');
        wq.set('model', modelName(getBackend));
        var vmWorker = new Worker('./worker.js?' + wq.toString());
        tl.mark('worker');
        tl.phase('vm-spawn', 'unpack', 'worker');
        vmWorker.addEventListener('error', function (e) { status(0, 'VM worker error: ' + e.message); });

        // Order matters: net stack first (its channels must exist before the
        // guest starts), image second (zero-copy transfer), tty channel last —
        // the tty message is what kicks the worker's boot path off.
        var nwStack = g.AskkNet.attach(vmWorker, getBackend);
        vmWorker.postMessage({ type: 'init', imagename: 'chunked-image', imagedata: imagedata }, [imagedata]);
        new TtyServer(slave).start(vmWorker, nwStack);
        status(65, 'VM starting — kernel boots in ~30-60s…');

        // Boot watchdog (ADR-048 known issue): the c2w socket handshake wedges
        // intermittently (~half of boots) — the CPU spins, the console stays
        // silent. Until root-caused upstream, a boot with no console output
        // for 25s auto-reloads the page, at most twice per session; console
        // output clears the strike counter.
        var bootT0 = Date.now();
        var wdTimer = setInterval(function () {
            if (bootDone) {
                sessionStorage.removeItem('askk-wd');
                clearInterval(wdTimer);
                return;
            }
            var quiet = Date.now() - Math.max(lastOutputAt, bootT0);
            if (quiet <= 25000) return;
            clearInterval(wdTimer);
            var strikes = Number(sessionStorage.getItem('askk-wd') || '0');
            if (strikes < 2) {
                sessionStorage.setItem('askk-wd', String(strikes + 1));
                status(0, 'boot stalled (known c2w race) — restarting… (' + (strikes + 1) + '/2)');
                setTimeout(function () { g.location.reload(); }, 800);
            } else {
                status(0, 'boot stalled twice — reload manually or try ?net=none');
            }
        }, 5000);
        return { vmWorker: vmWorker, master: master, slave: slave };
    }

    g.AskkBoot = { start: start, askkScanMarkers: askkScanMarkers };
    if (typeof module !== 'undefined' && module.exports) module.exports = g.AskkBoot;
})(typeof globalThis !== 'undefined' ? globalThis : self);
