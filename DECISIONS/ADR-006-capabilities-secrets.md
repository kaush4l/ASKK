# ADR-006 — Capability model and secret handling

> **Secret handling and outbound-network allowlists are a HUMAN GATE (PROMPT §17) — this ADR
> proposes, the user decides. Nothing here is provisional-approved.**

**Status:** Proposed — awaiting user ruling. Also pends ADR-003 (which interpreter hosts
forged modules shapes the capability-injection mechanics) and ADR-004 (the module contract
this grants against).

## Context

§4.1 is the design goal stated from the beginning: Ada-SI's forged skills run on the host OS,
can read `os.environ`, and therefore reach API keys — approval gates there reduce accidents
but are explicitly not a security boundary. In a browser with a Wasm core this inverts:
forged modules run in an interpreter with **zero ambient capability**. I6 makes it law:
capability-gated, default deny; secrets never enter a module's environment. The manifest (§6)
is where a module declares what it needs; the runtime is what enforces it.

Two separable questions: (1) how grants are modeled and enforced, (2) where the user's API
keys live and who can read them.

## Options — capability model

**A — Coarse permission flags.** Manifest lists strings (`"net"`, `"kv"`, `"clock"`); the
runtime checks the flag before each host call. Trivial to implement and to render in the
capability-review step of the forge pipeline (§7). Cost: `"net"` is all-or-nothing — a module
granted network can call anything; `"kv"` lets it read every other module's keys. Flags check
identity, not scope.

**B — Scoped capability handles (preferred).** A grant is data with parameters:
`net { allowlist: ["model"] }`, `kv { prefix: "module/water/" }`, `clock {}`. At module
invocation the runtime constructs `ctx` containing only the granted handles, each pre-bound to
its scope — the KV handle physically cannot form a key outside its prefix; the net handle
resolves symbolic endpoint names, not URLs. Nothing not in `ctx` exists, so default deny is
structural rather than checked.

**Case against B (the preferred):** it is more machinery — a grant grammar, per-capability
scope types, and a binding layer in `script/` that ADR-003 has not yet fixed. For v1's tiny
capability set (storage, net-via-broker, clock, emit-event, render) coarse flags plus a
prefix convention might honestly be enough, and B's scoping is only as strong as the binding
code. If the forge pipeline's capability-review step is doing its job, A + review may cover
the same accidents. B is still preferred because the review step guards *installs*, while
scoped handles guard *every call* — and §4.1's promise is structural, not procedural.

## Options — secret storage

**A — Plain IndexedDB record** (`config/keys/<profile>`). Simple, exportable, works today.
**B — WebCrypto-wrapped:** key material encrypted at rest under a non-extractable `CryptoKey`
stored in IndexedDB; plaintext exists only transiently in the broker's memory when a call is
made. Raises the bar against casual inspection (devtools storage browsing, a naive export
leak) and costs ~a page of code in `adapters_web`.

**The honest statement, either way:** this is a browser. Any secret the page can use, code
running on the page origin can exfiltrate — WebCrypto wrapping is not a security boundary
against compromised first-party code, only against at-rest snooping. The predecessor stated
the browser-visible-key trust model honestly (§4 prior art table) and so do we, in the UI
where keys are entered. The *real* boundary in this design is different and stronger: the key
never crosses into module world at all.

## Decision (proposed — user ruling required)

- **Manifest-declared, scoped grants (Option B), default deny.** Ungranted = absent from
  `ctx`, not present-but-refused. Enforcement lives in Tier-0 Rust, never in the interpreter.
- **Network is a brokered capability.** No module — forged or built-in — gets `fetch`. A
  module asks the broker for a *symbolic* endpoint (`"model"`); the broker holds the
  allowlist of user-configured base URLs (I2: outbound traffic only to configured endpoints),
  attaches the credential, makes the call, and returns the response envelope. Modules never
  see a key, a raw URL, or a header. **Additions to the allowlist are a user action in the
  settings UI, never a capability a module can hold** — the forge pipeline can request a
  grant to an *existing* endpoint, and that request is shown verbatim at capability review.
- **Keys:** store per-provider-profile under `config/keys/*` via storage Option B
  (WebCrypto-wrapped) unless the user rules the extra page of code not worth it; excluded
  from export by default (explicit opt-in checkbox, because export files travel).
- **Secrets never enter the paper either:** the Context Document (§8) carries provider
  *profile names*, never credentials — `render` output must be safe to golden-test and log.

## Consequences

- The affordance document advertises capabilities per module from the same grant data —
  generated, so it cannot drift (§6).
- Capability review in the forge pipeline renders the literal grant list with scopes; "why"
  comes from the module's manifest description per grant.
- Revocation is deletion of the grant record; next invocation simply lacks the handle (I10).
- A missing substrate (user configured no endpoint) makes the capability unavailable and
  un-advertised, not broken (I15).
- Cost: every new host capability needs a scope type and a binding — deliberate friction,
  and the right kind.

## Reversal cost

A → B or B → A on key storage is one adapter file and a data migration (ADR-005 ladder) —
hours. Widening the capability grammar later is additive. The expensive direction is
loosening the broker: once any module can see raw URLs or credentials, §4.1's headline claim
is gone and cannot be honestly re-made — which is exactly why this ADR stops at a human gate.
