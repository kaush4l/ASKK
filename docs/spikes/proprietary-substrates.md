# Spike: proprietary in-browser execution substrates (CheerpX/WebVM, CheerpJ, GraalVM)

> Evaluation memo. **No build was done.** This settles, on paper, whether the
> technically-strongest *proprietary* in-browser execution substrates are usable
> under ASKK's constraints, so the owner can make an informed call. The owner has
> explicitly asked about general in-browser code execution and named GraalVM/Java;
> this memo covers exactly those options that are excellent but not open.
>
> Companion reading: [`../EXECUTION_MODEL.md`](../EXECUTION_MODEL.md) (the
> execution-model decision), and the open-substrate spikes
> [`wasi-runtimes.md`](./wasi-runtimes.md) and
> [`container2wasm.md`](./container2wasm.md). Where this memo says "the open
> paths", it means those.

## ASKK's hard constraints (the bar every option is judged against)

ASKK is a Rust→WASM/Dioxus agent deployed as a **static site on GitHub Pages**, with
a **bring-your-own-key** LLM model and a **self-hosted origin we control**. So a
substrate is only a real option for us if it is:

1. **Self-hostable on our own origin** — the runtime artifacts must be servable from
   our gh-pages origin (or a CDN we control). We cannot make the product depend on
   pulling a closed runtime from a vendor's domain at request time.
2. **Open / freely redistributable** — consistent with a static, no-server, no-deal
   distribution. A "free for individuals to explore" license that forbids hosting
   the build elsewhere is not redistributable in the sense we need.
3. **Compatible with gh-pages headers** — anything needing cross-origin isolation
   (COOP/COEP, for `SharedArrayBuffer`) is a known friction point because GitHub
   Pages does not let us set arbitrary response headers. See "Cross-origin isolation
   on gh-pages" below.

These three are the lens for every verdict.

---

## 1. CheerpX / WebVM (Leaning Technologies)

### What it unlocks (it is genuinely the strongest option technically)

CheerpX is a two-tier x86 emulator — an interpreter plus a JIT that "generate[s]
efficient WebAssembly representations for hot code" — running **entirely
client-side** with no server. It runs *unmodified* x86 Linux binaries and complete
distributions, and it is the engine under [WebVM](https://github.com/leaningtech/webvm).
Concretely it unlocks:

- **Real Linux in a tab.** WebVM ships a Debian/Alpine userland; you get a genuine
  shell, Python, Bash, a working C/C++ toolchain (g++), etc. — not a curated subset.
- **Package managers.** Because it runs the real distro, `apt`/`apk` work (subject to
  networking, below).
- **Root.** Full superuser inside the virtual machine.
- **`ext2` persistence.** CheerpX streams disk blocks on demand over HTTP byte
  ranges and writes them, plus any user modification, to an **IndexedDB overlay**
  that "acts both as a caching-layer and as privacy-preserving persistent local
  storage." Supports disk images up to ~2 GB, enough for a full distro.
- **Networking via Tailscale.** Browsers expose no raw TCP/UDP sockets, so CheerpX
  tunnels traffic through Tailscale over WebSockets (Tailscale's DERP relays speak
  WebSockets) — i.e. it connects the tab into your private VPN. There is no general
  outbound sockets capability without that.
- **Near-usable speed.** Leaning Technologies state CheerpX is "expected to run
  complex applications 5x-10x slower than native, with the slowdown being as low as
  2x-3x for binaries that only stress the best optimized parts." That is genuinely in
  the usable range for a developer tool — far better than most emulators.

This is, on capability alone, the closest thing to "general code execution in a
browser tab" that exists. If the only question were power, CheerpX wins.

### Requirement: cross-origin isolation

CheerpX **requires `SharedArrayBuffer`, which requires the page to be cross-origin
isolated.** Per the CheerpX getting-started docs, the hosting page must send:

- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`

over HTTPS. This is the same COOP/COEP gate ASKK already navigates for threaded WASM;
see "Cross-origin isolation on gh-pages" below — it is surmountable but not free on
gh-pages.

### The decisive blocker: the engine is proprietary and self-hosting is forbidden free

WebVM the *project* is liberally-licensed FOSS, but **the CheerpX engine underneath
it is proprietary and separately licensed.** The free **CheerpX Community License**
covers individuals (personal projects, income or not), one-person companies, FOSS
projects, and technical evaluations — but it grants only **"unlimited, unmetered use
of CheerpX from the `cxrtnc.leaningtech.com` domain."** In other words, the free tier
means loading the closed engine from Leaning Technologies' CDN at runtime.

Self-hosting is explicitly carved out: the docs state **"If you wish to self-host
CheerpX, you will need a Commercial License,"** and **"downloading a CheerpX build
for the purpose of hosting it elsewhere is not permitted without a commercial
license."** Any use by an organization — including non-profit, academia, and public
sector — also requires a license. Pricing is **contact-sales** (no public price); the
homepage routes commercial use to "Contact us."

Why this kills it for ASKK specifically:

- **It defeats self-hosting (constraint 1).** Either we ship a runtime dependency on
  `cxrtnc.leaningtech.com` — making a "self-hosted static origin" product silently
  depend on a third-party vendor CDN, with their availability, telemetry, and terms
  in our critical path — or we pay for a commercial license to host it ourselves.
- **It is not redistributable (constraint 2).** We cannot vendor the engine into the
  gh-pages deploy. That is exactly the "host it elsewhere" the license prohibits
  without a deal.
- **The free tier's eligibility is also shaky for a real product.** "Free for
  individuals / one-person companies / FOSS / evaluation" fits a prototype, but a
  shipped product backed by anything more than one person, or any org, needs a paid
  license regardless of hosting.

So CheerpX is not a free drop-in; it is a **commercial-license decision**.

---

## 2. CheerpJ (Leaning Technologies)

### What it unlocks

CheerpJ is **the only credible way to run a real JVM in a browser tab.** It is
OpenJDK packaged as WebAssembly — "the JVM packaged as Wasm so Java applications can
run unmodified in a browser" — and as of **CheerpJ 4.3 (April 2026) it supports Java
8, 11, and 17.** It runs "existing, full Java applications from unmodified JARs, with
no recompilation or pre-processing, straight from bytecode," including obfuscated or
encrypted JARs. If the goal is "run real Java in ASKK," this is the route — there is
no open equivalent of comparable completeness.

It carries the same cross-origin-isolation expectation as CheerpX in practice
(WASM-JVM with shared memory), so the COOP/COEP gate applies here too.

### Same proprietary / self-hosting blocker

CheerpJ has the **identical licensing structure** to CheerpX: "commercial software,
free for FOSS projects, personal projects, and one-person companies; everyone else
needs a license." The free Community License again grants only **"unlimited,
unmetered use of CheerpJ from the `cjrtnc.leaningtech.com` domain"** (e.g. via npm),
and **"If you wish to self-host CheerpJ, you will need a Commercial License."**
Redistribution/OEM, multi-person business use, internal apps, and customer-facing
apps all require a commercial license.

So the same two failures apply: it defeats self-hosting (constraint 1) and is not
redistributable into our gh-pages origin (constraint 2) without a paid deal.

### CheerpJ is **not** GraalVM

Worth stating explicitly because the owner mentioned GraalVM: CheerpJ has **no
relation to GraalVM.** It is Leaning Technologies' own WASM JVM. "In-browser Java"
and "GraalVM" are two different conversations — see the next section.

---

## 3. GraalVM — not feasible as an in-browser runtime

The owner named GraalVM, so this records why it does **not** answer "run / compile
Java in the browser."

- **Standard GraalVM Native Image targets native binaries.** `native-image`
  AOT-compiles a JVM application into a **platform-specific native executable** for
  the host OS. That artifact does not run in a browser at all; it is the opposite of
  a browser deliverable.
- **"Web Image" is experimental, Early-Access only.** GraalVM does have a Web Image
  path that emits WebAssembly, but it is **"an experimental technology and under
  active development"** and requires **"an Early Access build of Oracle GraalVM 25
  (25e1) or later."** It is not in the stable `native-image` tool. Pinning a shipped
  product to an EA build conflicts with ASKK's "latest *stable*, low-maintenance"
  posture.
- **Web Image AOT-compiles one application — it is not an in-browser `javac`.** "Web
  Image takes a JVM application, performs ahead-of-time (AOT) compilation using
  GraalVM Native Image, and produces a WebAssembly module." It compiles *one app*
  ahead of time at *our* build step; it does **not** give the agent a runtime that
  can compile and run arbitrary Java the user supplies in the tab.
- **It needs a JavaScript host.** "You cannot run `.wasm` directly in Wasm runtimes
  because the generated module depends on JavaScript-provided imports and runtime" —
  the WASM module ships with a JS wrapper and must be hosted by a JS runtime.

Net: **"run GraalVM in the browser" / "compile-and-run arbitrary Java via GraalVM"
is off the table.** GraalVM Web Image could, in principle and someday, let *us*
precompile a fixed Java tool to WASM at build time, but that is a narrow, EA,
single-app pipeline — not the general in-browser Java execution the question implies.
**If ASKK ever wants real in-browser Java, the realistic route is CheerpJ (proprietary).**

---

## Cross-origin isolation on gh-pages (applies to CheerpX & CheerpJ)

Both Leaning Technologies products need cross-origin isolation (COOP/COEP) for
`SharedArrayBuffer`. **GitHub Pages does not let us set arbitrary response headers**,
so the usual escape hatch is a service-worker shim (e.g. `coi-serviceworker`) that
synthesizes the COOP/COEP headers client-side after first load. That works but adds a
moving part and a first-load caveat. This is a *shared* cost with the open threaded-
WASM substrates too, so it is not by itself disqualifying — but it compounds the
licensing problem rather than offsetting it.

---

## Decision matrix

| Substrate | What it gives ASKK | Self-hostable on gh-pages origin? | Open / redistributable? | gh-pages headers (COOP/COEP)? | Cost | **Verdict** |
|---|---|---|---|---|---|---|
| **CheerpX / WebVM** | Real x86 Linux in-tab: shell, `apt`/`apk`, g++, root, `ext2`+IndexedDB persistence, Tailscale net; 2-10x slower than native | **No** — free tier is CDN-only (`cxrtnc.leaningtech.com`); self-hosting forbidden without a commercial license | **No** — "downloading a CheerpX build to host it elsewhere is not permitted" free | Needs cross-origin isolation (SW shim) | Contact-sales | **Avoid for gh-pages** (re-open only as an *Eval-with-commercial-license* decision) |
| **CheerpJ** | The only real in-browser JVM: OpenJDK 8/11/17, unmodified JARs from bytecode | **No** — free tier is CDN-only (`cjrtnc.leaningtech.com`); self-hosting needs a commercial license | **No** — not redistributable into our origin free | Needs cross-origin isolation (SW shim) | Free for FOSS/personal/one-person; license otherwise | **Eval-with-license** (the only path to real in-browser Java) |
| **GraalVM (Web Image)** | EA AOT-compile of *one* fixed app to WASM at our build time; no runtime `javac` | N/A as a runtime | Experimental/EA, not a browser runtime | Needs a JS host | — | **Avoid** — not an in-browser execution runtime; not the answer to "run Java in the browser" |

---

## Recommendation

1. **Default to the open paths.** WASI runtimes and `container2wasm` (see the sibling
   spikes) are the substrates compatible with ASKK's open, self-hosted, gh-pages,
   BYOK model. They are weaker than CheerpX on raw capability but they are *ours to
   ship*. Treat them as the baseline for [`../EXECUTION_MODEL.md`](../EXECUTION_MODEL.md).
2. **Do not treat any Leaning Technologies product as a free drop-in.** CheerpX and
   CheerpJ are excellent and, for their respective niches (general Linux; real Java),
   *unmatched* — but using either as a shipped part of ASKK is a **commercial-license
   decision**, not an engineering default. The free tier's CDN-only hosting and the
   explicit ban on self-hosting the build are incompatible with "self-hosted static
   origin" without a paid deal.
3. **If in-browser Java becomes a real requirement, the answer is CheerpJ — under a
   license — not GraalVM.** GraalVM does not provide an in-browser Java runtime; its
   Web Image is an experimental, EA, single-app AOT pipeline.
4. **Action if pursued:** scope a Leaning Technologies commercial quote (CheerpX
   and/or CheerpJ self-hosting) and weigh it against the open substrates' capability
   gap. Until then, no integration work on either — keep them out of the dependency
   graph.

---

## Sources

- CheerpX site & docs:
  [cheerpx.io](https://cheerpx.io/),
  [Overview](https://cheerpx.io/docs/overview),
  [Getting started (COOP/COEP, CDN load)](https://cheerpx.io/docs/getting-started),
  [Licensing](https://cheerpx.io/docs/licensing)
- CheerpX 1.0 launch (perf 2-10x, `ext2`+IndexedDB, Tailscale):
  [labs.leaningtech.com/blog/cx-10](https://labs.leaningtech.com/blog/cx-10)
- WebVM (FOSS project over proprietary engine; Tailscale; persistence):
  [WebVM 2.0 blog](https://labs.leaningtech.com/blog/webvm-20),
  [WebVM repo](https://github.com/leaningtech/webvm)
- CheerpJ docs & releases:
  [cheerpj.com](https://cheerpj.com/),
  [Licensing](https://cheerpj.com/docs/licensing.html),
  [CheerpJ 4.0 (Java 8/11, unmodified JARs)](https://labs.leaningtech.com/blog/cheerpj-4.0),
  [CheerpJ 4.3 — Java 8/11/17 (Apr 2026)](https://bytecode.news/posts/2026/04/cheerpj-4-3-webassembly-based-jvm-for-the-browser)
- GraalVM Web Image (experimental/EA, AOT one-app, JS host):
  [Web Image reference](https://www.graalvm.org/latest/reference-manual/web-image/),
  [Getting started with Web Image (JDK 25)](https://www.graalvm.org/jdk25/reference-manual/web-image/)
- Cross-origin isolation background (COOP/COEP + `SharedArrayBuffer`):
  [web.dev: COOP & COEP](https://web.dev/articles/coop-coep),
  [gh-pages cannot set these headers (community discussion)](https://github.com/orgs/community/discussions/13309)
</content>
</invoke>
