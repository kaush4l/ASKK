# MORNING.md — overnight run report (2026-07-29)

```
done:         G0 (4 spikes ran + 6 research docs), G1, G2 (ARCHITECTURE + all 10 ADRs),
              G3 (8-crate interface freeze, compiles, layering CI green),
              G4 (walking skeleton — verified live in a real browser against a real
              local model; screenshot in session log). All gates committed in sequence
              on main; every commit green.

spikes:       A WORKED — handle()→Wasm→vendored htmx 2.0.10 via ~35-line extension;
                streaming = core-driven hx-trigger chaining, 3 visible chunks;
                6/6 native + 2/2 headless-Chrome tests. Caveat: ~1 s/hop in harness.
              B WORKED — Rhai module from data string: route, fragment, default-deny
                + one grant, typed errors; 6/6 tests; 452 KB wasm.
              C WORKED — 11-section paper, pure assemble/render, golden + static-prefix
                byte-identity + deterministic recorded degradation; 7/7 tests.
              D WORKED — hand-rolled web-sys IndexedDB KV; 3/3 headless tests;
                put p50 0.11 ms; wrapper crate rejected (52-crate tree, pin conflict).
              G4 slice — dashboard through the seam; real chat turn (LM Studio via
                serve.py /v1 proxy) answered in-page; typed error fragment on failure;
                events persisted to IDB and replayed on reload (3→12 facts observed);
                installable (manifest + caching-only SW); 19 host tests green.

provisional:  ADR-002 transport B + chaining — Accepted PROVISIONAL (reversal: low,
                transport-only swap).
              ADR-003 Rhai — Accepted PROVISIONAL (reversal: medium; named trigger →
                QuickJS as Tier 3 WASI if LLM-authored Rhai fails static-validate).
              ADR-001 name: "umwelt" recommended, collision-checked — YOUR PICK.
              ADRs 004,005,007,008,009,010 — Proposed with evidence attached.
              ARCHITECTURE: 13→8 crates; core on MAIN THREAD for now (Worker move is
                transport-only, deliberately deferred — Spike A proved the fallback).
              Phase cut: Work/Verify + Plan-on-demand + cheap Answer exit (R6 evidence;
                reversal = routing config one-liner).
              G3/G4 signature drifts (14 items, all flagged in doc comments +
                MODULES/*.md): biggest = sync pump + drive(Rc<RefCell<App>>) because an
                async &mut App wedged concurrent seam polls during the model await.

blocked:      1. ADR-006 capability model + secret handling — HUMAN GATE by design.
                 Recommended default: WebCrypto-wrapped keys in IDB, brokered network
                 with user-only allowlist edits, honest browser-visible-key statement.
              2. Project name (ADR-001). Recommended: umwelt.
              3. gh-pages still serves the old ASKK page; publish.sh is ready but was
                 never run — replacing the live page is your call.
              4. OpenAI direct-from-browser is unverifiable without a live key
                 (R3: preflight passes, 401 lacks ACAO). Default: route via OpenRouter.

risks:        1. Model-authored Rhai quality — every forged module is LLM-written and
                 models write JS ≫ Rhai; the reversal trigger exists but firing it means
                 building the WASI substrate earlier than planned.
              2. Streaming latency — chaining showed ~1 s/hop in the headless harness vs
                 250 ms declared; if that holds at real token rates the chat feels slow
                 and ADR-002's streaming half reopens (SSE ext is the fallback).
              3. Main-thread core — a runaway forged module freezes the page including
                 the abort button; the Worker move must land before the forge pipeline
                 ships (G6 order guards this, but it is a standing gap).

next:         with four hours — (1) move the core into the Worker (transport-only per
              ARCHITECTURE §1d) and re-measure chaining latency in a real page;
              (2) persist registry state so boots stop re-appending ModuleInstalled
              (log grows ~4 events/refresh); (3) SW dev-mode bypass (stale pkg/ bit the
              G4 pass once); (4) wire history into the paper so a second chat turn
              carries the first; (5) rename repo artifacts once you pick the name.
```

Full evidence: `RESEARCH.md`, `docs/research/*.md`, `spikes/*/README.md`, `DECISIONS/`,
`ARCHITECTURE.md`, `MODULES/`. Run it: `python3 serve.py` (needs a local OpenAI-compatible
upstream on 8873, e.g. LM Studio) → http://localhost:8901.
