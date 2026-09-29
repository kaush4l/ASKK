# Browser Linux eager-proxy startup diagnostic

**Browser comparison stopped at A1; inconclusive.** The unchanged private guest reached Ready in 497.377 seconds. A1 did not reach its entry marker within the registered 180-second limit; its actual cancelled SIGTERM exit arrived at 193.595 seconds. B1, B2, and A2 were not started. Disposal checkpointing acknowledged in 1.985 seconds, with zero guest frames remaining. This establishes no proxy speedup and changes no public runtime. [Browser receipt](evidence/browser-linux-proxy-offline-chrome.json).

The [native preflight](evidence/browser-linux-proxy-native.json) passed on 2026-09-29: both offline arms exited zero with different expected Undici markers and matching identity. Those native timings do not establish browser performance. The dedicated Colima profile was stopped before the browser trial.

This is a registered, private diagnostic plan. Scheduling waits for the root agent's internal CPU/model-evaluation bracket to end; no additional user approval is required. No production runtime, image, network setting, or build command is changed by this plan.

## Evidence and hypothesis

The latest [cache-admission receipt](evidence/browser-linux-main-webpack-cache-admission-chrome.json) shows that the guest accepted webpack's small loader cache but did not reach large `bundle5.js` acceptance within 180 seconds. Cancellation produced an actual SIGTERM exit at 199,186.5 ms, and shutdown checkpointing succeeded. No cache-on/off comparison or Next build followed.

Certain source facts: the runtime sets `NODE_OPTIONS=--use-env-proxy`; the shipped network adapter supplies HTTP(S) proxy variables. [Pinned Node 24.21 startup code](https://raw.githubusercontent.com/nodejs/node/v24.21.0/lib/internal/process/pre_execution.js) loads internal Undici and constructs its proxy agent before the user entrypoint when both conditions hold. [Pinned CLI documentation](https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/cli.md) gives command-line options precedence over `NODE_OPTIONS`.

**Likely hypothesis, unproven:** this eager initialization contributes materially to pre-entry startup latency. Native cache runs did not explicitly inject proxy variables, but their effective presence was not recorded. Output-arrival gaps also include transport/buffering; they are not CPU-phase measurements.

## Fixed experiment

Use the existing pinned Node 24.21.0 ARM64 UID0 image and private candidate `c2w-node24-8f08d6cef80797be`, keeping its current max-opt supervisor wrapper. Node binary SHA256: `0f8949d1028f6d61506b2d5bc57e7e6fe893d7b1997509b7847294fc9c616584`. Expected main V8 cache tag: 2292197379.

Both arms have identical cwd, inherited proxy/CA settings, payload and V8 tier. Keep `NODE_OPTIONS` intact. Use structured argv; the payload is one literal argument.

```text
A: env -u NODE_COMPILE_CACHE -u NODE_DEBUG_NATIVE NODE_DISABLE_COMPILE_CACHE=1 node --max-opt=0 --use-env-proxy -e PAYLOAD
B: env -u NODE_COMPILE_CACHE -u NODE_DEBUG_NATIVE NODE_DISABLE_COMPILE_CACHE=1 node --max-opt=0 --no-use-env-proxy -e PAYLOAD
```

`PAYLOAD` emits synchronous ENTRY/EXIT markers with `fs.writeSync`. It reports Node version/architecture, uptime, presence booleans for the four HTTP(S) proxy variables and extra CA configuration, whether `NODE_OPTIONS` contains the known proxy flag, and:

```js
process.moduleLoadList.includes('NativeModule internal/deps/undici/undici')
```

It performs no network request, DNS lookup, package/module workload, project-file operation or child spawn. Never print proxy values, arbitrary environment variables or credentials. No cache, profiler or debug logging.

1. **Native preflight:** verify the negative flag is accepted and overrides `NODE_OPTIONS=--use-env-proxy`. Capture existing proxy-variable presence only in that negative-override process. Then explicitly give both arms the same four synthetic proxy values, `http://192.168.127.253:80`. Require `code: 0`, both markers, equal presence booleans, and Undici loaded in A but absent in B. Check pinned identity/cache tag separately. Bound each command at 30 seconds; stop on unsupported flags, mismatches or nonzero exits. Save hashes/receipts and stop dedicated Colima.
2. **Browser:** after a separate quiet bracket, boot one unchanged private-profile guest with its existing 600-second handshake bound. Record hashes, visibility, prior checkpoint status and overlap. Run A–B–B–A sequentially. Each job has a 180-second host-wall bound plus 30 seconds to receive cancellation/exit. Any deadline is a failure, even if `code: 0` arrives later. Never infer a kill without its receipt.
3. **Comparison:** require all four actual successful exits and the expected Undici markers. Primary metric is host time from request to exit; marker-arrival times and guest uptime are supporting data. A practically useful signal requires both B runs to be at least 20% and 10 seconds faster than both A runs. Incomplete or overlapping results are inconclusive. Do not average away timeouts.
4. **Stop:** on any timeout, missing marker, identity mismatch, nonzero exit, unexpected network activity or unresponsive runtime, queue no further jobs. Preserve evidence and explicitly dispose with a 60-second checkpoint bound. Record acknowledgment or persistence unknown. Do not automatically run webpack or a full build.

## Network boundary and interpretation

The negative CLI flag affects only the explicitly launched offline child. It does not modify the supervisor environment, certificates, browser proxy, companion authorization, public configuration or future ordinary jobs. The payload spawns no children that could inherit execution flags.

Do not use this override for arbitrary npm commands or user builds: those may need proxied networking. Even a clear result would establish only a contribution to trivial-process startup in this private profile. Any future lazy or supervisor-only initialization design needs separate network regression proof. If the result is small or inconclusive, a later separately scheduled diagnostic can isolate source reads, parsing and module evaluation; another full build is not the automatic next step.
