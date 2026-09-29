# Optional capability bridge — fresh plan, 2026-09-29

This review starts from source `ad40356`. **Certain from code:** the existing
browser kernel and portable companion are useful foundations; a replacement
runtime is unnecessary. **Likely design judgment:** the next useful slice is
honest capability discovery plus enforceable model-only routing. A downloadable
directory already exists; simplifying trust and adding host targets come after
that boundary is real.

## Preserve the browser-owned kernel

`src/core/engine.js` runs the model/tool loop. `src/runtime/agent.worker.js`
instantiates one agent thread; `src/runtime/hub.js` owns dispatch, approvals,
records and lifecycle. `src/core/strategy.js` and `src/runtime/strategy-hub.js`
schedule configured bounded role graphs. Keep those responsibilities in the
browser. A companion is a capability provider: it accepts an authorized model,
network, file, command or browser operation and returns observations. It never
chooses a goal, loads an agent definition, schedules roles or continues a model
loop after the browser goes away.

The unified folder compiler already accepts static `agent.md`, adjacent
`soul.md`, declared context/resources, service roles and model/tool bindings for
both shipped and imported agents. Continue that path. Names such as `coder`,
`main` and `researcher` confer no authority. Package configuration requests a
capability; installation grants and current adapter availability narrow it.
Application tools remain trusted code. Imported executable modules are rejected.
See [the exact package contract](UNIFIED-AGENT-PACKAGES.md).

Keep configurable iteration limits, output/context budgets, repair counts and
strategy parallelism. Keep deterministic enforcement of admission, cancellation,
policy, hard budgets, malformed/truncated replies, stale results and completion
receipts. Removing these guards would turn a configurable agent into an
unbounded or falsely successful process. Effort settings should configure the
loop and provider; they must not depend on task keywords or hardcoded branches.

Coding is one declared workflow using files, commands, artifacts and an
independent revision-bound check. A general answer requires no command runtime.
Future completion checks should be named trusted adapters selected in workflow
configuration; each should return evidence and an explicit outcome. Do not add
an `if task is coding` branch to the engine. The present `workspace.acceptance`
hook is a migration seam, not the universal completion contract.

UI comes from sequenced run/tool receipts: a confirmed file change updates the
file viewer, a job opens command output, a browser operation supplies an observed
page artifact. The model chooses tools and emits task content. It does not
instruct the frontend to create cards or fabricate progress. A parent link is
not proof that a message was delivered. Use the existing event projections and
the [desk UX proposal](FRESH-DESK-UX-2026-09-29.md).

## What actually exists

| Existing part | Reuse | Boundary still missing |
| --- | --- | --- |
| `host/companion.js` | Bun HTTP/WebSocket host, auth/origin checks, root-based file API, CAS writes, streaming jobs, process-group cancellation, PTY, model/network relay | Capability list reports grants rather than verified implementation/readiness; at the reviewed baseline `/fetch` accepts `model-relay` and arbitrary HTTP(S) URLs |
| `scripts/companion/` | Fixed payload allowlist, reviewed Bun pin, manifest hashes, relocated launcher, private pairing file, selected child environment | Only Darwin ARM64; external browser-trusted TLS and explicit paths required; signing/installer absent |
| `src/execution/local.js` | Native execution port and real output/exit handling | Bun identity is assumed; it is not a host-independent capability registry |
| `host/bridge.js` | Historical CLI/MCP compatibility | Broad defaults; distinct protocol; model CLIs can themselves be agent runtimes and are outside the desired minimal package |
| Browser workers and IndexedDB | Generic agent execution, durable records, imported definitions | Worker transport credentials remain accessible; broker isolation is pending |

The current package ships Bun plus ten explicitly listed files; it does not ship
the repository, agent loop, project dependencies, model weights or a browser.
The recorded relocated native acceptance is valuable but does not establish a
signed download, trusted installation or iPhone operation. Rooted filesystem
API checks are not an OS sandbox: granted commands retain the owner's host
privileges. Bundling Bun makes command lookup reproducible; it cannot make every
language, native addon, browser or external service exist.

## Small next implementation slice

Implement a server-enforced model-only scope in the current companion and its
launcher, with a versioned descriptor consumed by the current model adapter.
Do not introduce a new transport framework or new daemon.

1. Repeatable `--model-endpoint BASE` grants only the exact current inference
   routes under that base: `GET /models`, `POST /chat/completions` and
   `POST /messages`. No admin/model-management subtree, speculative `/responses`
   route or automatic localhost grant. Paths are relative to the configured base.
2. `/model/fetch` requires `model-relay` plus an explicit matching endpoint.
   Refuse other destinations/methods, ambiguous paths, query/fragment/userinfo,
   routing/method-override headers and all redirects. Use a provider-header
   allowlist. A missing scope fails closed with an actionable error.
3. Preserve `/fetch` compatibility: an explicit generic `fetch` grant enables
   general fetching; without that grant, old model-only callers receive the same
   model scope enforcement. `/network/fetch` separately requires `network-relay`.
   New model clients always use the scoped route, even when generic fetching is
   also granted.
4. Pairing returns `modelRelay: {version: 1, endpoint: '/model/fetch', endpoints:
   [...], status: 'configured' | 'scope-required'}`. This describes authority,
   not successful model inference. Include it in connection identity so changed
   scope invalidates old probe evidence. `GET /health` may describe the service;
   authenticated `/whoami` is authoritative for pairing.
5. Preserve streaming/cancellation and existing native grants. Tests must prove
   refused requests do not reach either upstream, including redirect chains,
   neighboring path prefixes, encoded paths, hostile headers and methods.

This slice makes the existing promise true: pairing for inference does not grant
general host network access or select native execution. It does not yet isolate
credentials from workers, attest remote model quality or secure an upstream
server whose own inference route executes privileged actions.

## Capability discovery contract after that slice

Use one authenticated, versioned manifest, added to the existing pairing flow.
Keep the current string grants during migration. Do not turn unrecognized
protocols or missing fields into usable capabilities.

```json
{
  "protocol": {"name": "askk-capabilities", "version": 1},
  "instanceId": "fresh-on-every-host-start",
  "platform": {"os": "darwin", "arch": "arm64"},
  "capabilities": [
    {
      "id": "model.infer",
      "adapter": "http-model-relay",
      "supported": true,
      "availability": "configured",
      "grant": "allowed",
      "scope": {"endpointIds": ["local-model"]}
    },
    {
      "id": "browser.control",
      "adapter": null,
      "supported": false,
      "availability": "unsupported",
      "grant": "denied",
      "reason": "No browser automation adapter is installed."
    }
  ]
}
```

The browser stores a separate `lastProbe` receipt with time, instance, adapter and
scope identity. `configured` never means ready. At least these states must remain
distinct: unsupported implementation; missing host dependency; denied grant;
scope required; disconnected; browser cannot read transport; authentication
failure; configured but untested; actual probe success/failure; interrupted with
unknown remote outcome. Do not diagnose a certificate, CORS or local-network
permission failure from a generic browser fetch exception.

Capabilities should eventually separate `model.infer`, `network.fetch`,
`files.read`, `files.write`, `commands.run`, `terminal.open` and
`browser.control`. A browser adapter must report which browser/session it can
control and whether it owns that session. File roots, network destinations,
command environments and browser sessions are distinct scopes. Availability and
grants are rechecked at dispatch; a changed host instance invalidates retained
execution readiness and verification. Child agents inherit restrictions.

Keep adapters small and replaceable: `describe`, `probe`, `invoke`, `cancel`, and
typed sequenced results. Existing job IDs/runtime IDs/exit receipts should stay
intact. Adding Linux or Windows should implement these ports, with genuine
platform cancellation/PTY behavior; it should not clone the browser agent engine.

## Actual browser/model support

Verified primary sources on 2026-09-29:

- **Certain:** current Chrome documents the web Prompt API from Chrome 148 and
  extensions from Chrome 138. Availability is feature/hardware dependent;
  `LanguageModel.availability()` distinguishes `unavailable`, `downloadable`,
  `downloading` and `available`. Workers are unsupported, so a future browser
  model adapter belongs in the page broker while agent loops stay in workers.
  [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api) and
  [model download states](https://developer.chrome.com/docs/ai/get-started#model-download).
- **Certain:** Chrome foundation-model APIs exclude iOS and Android. Desktop
  success is not iPhone support. [Chrome hardware requirements](https://developer.chrome.com/docs/ai/get-started#hardware).
- **Certain:** Apple documents native Swift and Python Foundation Models APIs. The [official Python SDK](https://apple.github.io/python-apple-fm-sdk/getting_started.html) requires a compatible Mac, macOS 26+, Xcode 26+, Python 3.10+ and enabled Apple Intelligence. These are possible native adapter dependencies, not bundled ASKK capabilities.
  **Likely conclusion:** no documented public Safari JavaScript API for direct
  access to Apple's generative model was found. WebKit's Prompt API standards
  position is `oppose`; Safari 27's release notes do not announce equivalent
  access. Do not present this as proof about every private/future API.
  [Apple Intelligence](https://developer.apple.com/apple-intelligence/),
  [WebKit position](https://github.com/WebKit/standards-positions/issues/495),
  [Safari 27 release notes](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/).
- A later native Apple adapter can report `SystemLanguageModel` availability,
  including device ineligibility, Apple Intelligence disabled, and model not
  ready. A plain webpage cannot infer those native states from Safari branding.
  [Apple availability reasons](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason).

Browser-native models are optional providers, not the universal default.
On iPhone, the current viable product contract is a browser kernel with an
explicit reachable HTTPS model provider. A companion listening on desktop
`127.0.0.1` is unreachable from an iPhone: the phone's loopback means the phone.
Remote hosts require a separately designed authenticated transport and lifecycle,
not binding today's privileged companion to `0.0.0.0`.

## Distribution choices and tradeoffs

| Option | Benefit | Cost / truthful claim |
| --- | --- | --- |
| Existing versioned directory archive, per OS/architecture | Smallest step; bundled runtime; inspectable payload; no repo checkout or dependency install | Current support only Apple Silicon macOS; external TLS/manual launch remains; hashes detect corruption, not publisher authenticity |
| Signed/notarized macOS app wrapping the same capability server | Easier launch, host permission controls, certificate/trust onboarding; optional Swift Foundation Models adapter | Signing/update/trust lifecycle needs real implementation and OS acceptance; no new agent runtime required |
| Per-platform CLI packages | Reuse protocol on Linux/macOS/Windows; explicit grants suit advanced users | Separate runtime provenance, shell, PTY, process-group/job-object and path tests; Windows is not proved by Bun existing there |
| Native iOS app or Safari extension/native bridge | Potential Apple-model access through native code | Separate product/integration and permissions; never promise ordinary Safari pages get Foundation Models automatically |
| Remote capability host | iPhone can use a desktop or server resource | Explicit authenticated encrypted reachability, scope/session ownership and reconnect semantics; existing loopback server is not this product |

Ship a pinned runtime and built-in capabilities necessary for the selected profile.
Declare optional browser binaries, external model servers and language toolchains
as dependencies until the package actually bundles them. Avoid arbitrary CLI
agent adapters in the minimal distribution. A browser automation pack can be an
optional independently granted install later; do not label browser control ready
merely because a JavaScript worker exists.

For the immediate Mac archive, retain the payload allowlist, manifest, licence
notices, private external credential files and moved-directory test. Add immutable
release identity and authenticated publisher provenance before calling it a
public release. The existing package documentation already separates these gates.
See [Bun standalone distribution](https://bun.sh/docs/bundler/executables),
[Apple macOS distribution](https://developer.apple.com/macos/distribution/), and
[Apple notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Acceptance and order

First complete the model scope slice and focused negative/streaming tests; then
pair the relocated package in current desktop Safari and Chrome using explicitly
trusted TLS. Record browser versions, exact package hash, grants/scope, model
probe receipt and reconnect behavior. A relay-only run must reject files,
commands, terminals and general network requests at the server. A failed or
stopped relay must preserve the browser task/draft and must not silently select a
different provider or command environment.

Next implement the complete capability manifest and page-owned credential broker;
then simplify signed Mac distribution and add platform adapters with independent
acceptance. Test iPhone Safari and Chrome separately for general tasks, import,
foreground/reload lifecycle and reachable HTTPS inference. Browser suspension is
an interruption boundary, not an unattended-agent guarantee. Native inference,
browser automation and browser-contained builds each require their own proof.

This order improves modularity and deployment ease while preserving already
working package, runtime, execution and evidence code.

## Follow-through and published checkpoint

The requested minimal scope slice is published in source `91612b9`, with host
payload source `cf6b594`. It uses the descriptor and route contract above, with
durable protocol pinning before activation, fail-closed downgrade detection and
revocation propagated to active workers. The remaining capability manifest,
credential broker, native Apple adapter and additional distribution options are
proposals.

Focused verification passed **50 tests / 438 assertions** across
`test/companion.test.js`, `test/companion-package.test.js` and
`test/model-connection.test.js`. This includes 29 refused request variants on
both model routes, 15 non-followed redirects, real incremental stream cancellation,
launcher propagation, independent grants and a real browser-style worker using
the scoped endpoint. These are disposable HTTP/server/worker fixtures, not a
Safari/iPhone acceptance or live-model result. That initial fixture run used no
token, certificate or live model and restarted no existing relay.

The subsequent [package receipt](evidence/companion-scoped-package.json) records
the committed, relocated archive with bundled Bun and its published hash. The
[actual Pages Chrome check](evidence/scoped-relay-pages-chrome.json) then paired
that package using existing trusted TLS, completed real model replies and an
approved task-plan tool call with only `model-relay`, restored pairing/draft, and
downloaded the matching archive. The final suite passed 709 tests with one CLI
skip. Native Safari/iPhone, fresh TLS onboarding and signed distribution remain
unverified; the current archive is explicitly an unsigned developer preview.
