# ADR-008 — Hosting and cross-origin isolation

**Status:** Proposed — pends spike A (the streaming answer in ADR-002 must be proven to work
without COI; SSE-shaped and message-driven approaches do, but "prove, don't assume" — §5) and
the ADR-002 transport decision itself.

## Context

I1: the app builds to static assets, no server runtime. The settled host is GitHub Pages,
which means the app lives under a **repository subpath** (`https://<user>.github.io/<repo>/`)
and cannot set response headers — no COOP/COEP, no server-set CSP, short cache lifetimes
(ADR-007 owns that last one). The predecessor lived with both constraints: its
`serve.py` existed to inject COOP/COEP locally because the c2w VM needed
`SharedArrayBuffer`, and on Pages the same headers were faked by a SW re-writing its own
responses — the well-known coi-serviceworker double-load dance. Its `publish.sh` deployed
`docs/` to `gh-pages` via a worktree with hard pre-push gates.

HARNESS v1 is a different animal: §10 says multi-agent is **one Worker per agent,
message-passing only**, and the Tier 4 appliance (the one true SAB customer) is deferred past
v1. So the question is whether to carry the COI machinery anyway.

## Options — cross-origin isolation

**A — COI from day one** (SW-injected COOP/COEP, predecessor-style). Ready for SAB whenever a
measurement demands it; local dev and Pages behave identically. Costs, all recurring:
the double-load on first visit; every debugging session includes "is the COI SW active yet";
and COEP constrains every cross-origin fetch the page makes — `require-corp` breaks any
resource without CORP headers, `credentialless` narrows it but is not universal. For an app
whose entire purpose includes user-configured outbound calls to arbitrary BYOK endpoints,
adopting a header regime that can interfere with fetches is pure downside carried for a
customer (SAB) that does not exist in v1.

**B — No COI in v1 (preferred).** Plain static hosting, plain headers. Workers communicate by
`postMessage`; the workload is I/O-bound on a remote model (§10), so structured-clone message
passing is almost certainly sufficient parallelism.

**Case against B (the preferred):** if a measurement later shows serialization is a real
cost — large multimodal parts shuttled between agent Workers, or a Tier 4 appliance arriving
earlier than planned — retrofitting COI is not a header flip: it is the SW dance plus an
audit of every cross-origin fetch under COEP, exactly the migration the predecessor already
paid for once. Pre-paying now avoids paying under pressure later. The counter-counter: §10
explicitly forbids reaching for shared memory *without a measurement*, the predecessor's own
ADR-052 measured the emulator single-threaded anyway (SAB bought less than assumed), and the
port stays open — nothing in v1's design assumes non-isolation, it merely doesn't require
isolation. Default no; COI is the exception to be earned by numbers.

## Options — hosting surface

**A — GitHub Pages, repo subpath (preferred).** Free, already the deploy target, zero ops.
Imposes the **relative-URL rule**: every asset reference, htmx route, Worker script URL, and
the SW registration are relative, and the SW is registered with a relative scope so
`__routes` resolve under `/<repo>/` (the predecessor's SW documents exactly this; its
gh-pages memory records the one historical failure mode — an absolute path embedded in built
JS producing a white page with no console error). The app must never mention its own origin
or mount point.
**B — Custom domain (CNAME) on Pages.** Serves from `/`, nicer URL, still free. Adds DNS as a
dependency and, notably, changes the *origin* — and the origin is where all user data lives
(I2). Flipping later orphans IndexedDB/OPFS; the ADR-005 export/import file is the designed
bridge, but it is a manual user step. So: supported later, via export/import, not defaulted.
**C — Any static CDN (Netlify/Cloudflare).** Would grant real headers (COOP/COEP/CSP) and
long cache TTLs. Rejected for v1: a second vendor for a problem we are choosing not to have
(Option B above), and the relative-URL rule keeps it a pure redeploy away.

## Decision (proposed)

- **GitHub Pages, repo subpath, relative URLs everywhere** — enforced by a deploy-script gate
  that greps built artifacts for origin-absolute paths (predecessor `publish.sh` pattern:
  gate hard, then worktree-push to `gh-pages`).
- **No COOP/COEP, no SAB, no COI in v1.** One Worker per agent, `postMessage` only. The seam
  that keeps this reversible: nothing outside `adapters_web` knows how Workers talk (I3).
  Reopening COI requires a measurement written into an ADR amendment, per §10.
- **CSP via `<meta http-equiv>`** — best-effort defense-in-depth, honestly labeled: meta-CSP
  cannot express `frame-ancestors` or reporting, and `connect-src` must stay open because
  BYOK endpoints are user-configured at runtime (the *real* egress control is the ADR-006
  broker allowlist, which is enforceable and auditable where CSP here is not).
  `script-src 'self' 'wasm-unsafe-eval'` — no inline script, no eval; forged modules are
  interpreted data (§7 L2), never `eval`, so the strict directive costs nothing.
- **Forge preview iframes** (§7) use the `sandbox` attribute — that isolation is per-element
  and needs no COI.
- **Local dev:** a predecessor-style stdlib static server, minus the header injection it no
  longer needs; optional `/v1` proxy stays the clearly-marked dev-time network broker
  (§2 non-goals).

## Consequences

- First load is one load; debugging has no SW-activation phantom; BYOK fetches face only
  standard CORS, which the G0 research item ("which providers are callable from a hosted
  browser origin") already scopes.
- The subpath is a permanent discipline: every new module route and asset must be relative,
  and the CI gate is what keeps that true rather than reviewer vigilance.
- Tier 4 or measured-SAB work must reopen this ADR before it can exist.

## Reversal cost

Adding COI later: the SW-injection pattern is proven in-repo (`80564a2:docs/askk-sw.js`) —
days, plus a COEP audit of cross-origin fetches; no data loss, same origin. Moving hosts or
to a custom domain: redeploy is trivial, but the origin change severs browser storage —
user-mediated export/import required, which is why it is not the default. The cheap-to-keep,
expensive-to-break asset is the relative-URL rule; hold that and every hosting door stays
open.
