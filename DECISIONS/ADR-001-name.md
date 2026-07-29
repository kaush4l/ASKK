# ADR-001 — Project name

**Status:** Proposed (PROVISIONAL — this is taste; the human picks. This ADR only narrows the field.)

## Context

"HARNESS" is an explicit placeholder (PROMPT §2). The metaphor the name must carry is the phone:
a hosted environment the agent *lives inside* — capabilities, a sandbox, legible affordances,
observation. The name should describe the environment, not the agent, and not the task.

Constraints:

- Must not collide with a dominant project on npm, crates.io, or GitHub. Weighting matters:
  this project publishes **no npm package** (htmx frontend, no build step), so npm is
  reputational only; **crates.io matters most** (workspace crates will be `<name>-kernel`,
  `<name>-context`, …); GitHub matters for discoverability of the repo itself.
- Lowercase-friendly, one word, typeable, pronounceable by one human daily.
- The predecessor names (ASKK, and the scrapped Rust harness — see `docs/prior-art/three-layer.md`)
  are retired; this is a new thing and should read as one.

Collision check, 2026-07-29 (HTTP status of registry lookup; 404 = free):

| Name | npm | crates.io | GitHub (`in:name`) |
|---|---|---|---|
| umwelt | taken | **free** | 363 repos, none dominant (top hit: unrelated German emissions app) |
| bothy | **free** | **free** | 93 repos, all tiny (≤3 stars) |
| handset | taken | **free** | 231 repos, minor (ExpressLRS RC radio, 38★) |
| vivarium | taken | taken | 561 repos; inclement/vivarium (Wayland compositor, 423★), ihmeuw/vivarium (sim framework) |
| ambit | taken | taken | 3122 repos, crowded |
| satchel | taken | taken | Microsoft's Flux-pattern library owns the npm name |

## Options

**umwelt** — von Uexküll's term: the world as it exists *for one organism* — what it can sense
and what it can act on. Gibson's affordance theory, which PROMPT §2 leans on by name, descends
directly from it. An agent's capabilities + affordances + observations *are* its umwelt; the
project is literally "build the agent an umwelt." Crates free, GitHub clear.

**bothy** — a small stone shelter in the Scottish hills: unlocked, maintained, free to any
traveler, carrying everything needed and nothing else. Hosted shelter the agent inhabits; humble
and small, which matches I12 and the one-user scope. Cleanest collision profile of all six.

**handset** — the phone metaphor taken literally: the thing carried, picked up, and used.
Immediately legible; slightly generic, and it names the device rather than the *inhabited
environment*, which is the half of the metaphor that matters.

**vivarium** — an enclosed, observable habitat built to keep something alive: sandbox +
observation in one word. Best pure-semantics fit after umwelt, but both registries are taken and
a 423-star compositor shares the name in systems space. Eliminated on collisions.

**ambit** — "the scope of one's powers"; capability-flavored, short. Eliminated: crowded
everywhere and emotionally flat.

**satchel** — the carried container. Eliminated: Microsoft collision, and a satchel is what the
*user* carries, not where the agent lives.

## Trade-offs

- Conceptual precision (umwelt, vivarium) vs. immediate legibility (handset, bothy).
- Collision-free registries (bothy, umwelt-on-crates) vs. evocative but contested names.
- A one-user project needs no SEO; it needs a name the one user enjoys typing for years.

## The case against my favorite

umwelt is the favorite, so argue against it: it is obscure — nobody who hasn't read ethology or
Gibson will parse it; it invites explaining the name instead of the system; it is a German noun
and will be miscapitalized and mispronounced ("OOM-velt") forever; the npm name is taken, so if
a JS shim ever *is* published it needs a scope; and there is a whiff of pretension in naming a
solo tool after a phenomenology concept. bothy has none of these problems and the cleanest
namespace of all six candidates.

## Decision

**Recommend `umwelt`**, runner-up `bothy`. The concept is not decoration here — the four things
the environment provides (PROMPT §2) are a textbook definition of the term, and the affordance
document (§6) makes the lineage literal. crates.io is free for the bare name and the crate
prefix (`umwelt-kernel`). If the human vetoes on pronounceability, take `bothy` without a second
round.

## Consequences

- Repo, crate prefix, and PWA manifest name change once, before G3 freezes any identifier.
- `HARNESS` remains the placeholder in all documents until the human ratifies; a single
  find-replace pass updates PROMPT/GLOSSARY/ARCHITECTURE at ratification.
- Register the GitHub repo name and crates.io bare crate promptly after ratification.

## Reversal cost

Near zero before G3 (find-replace across docs). After G3 it touches crate names, the PWA
manifest, and storage namespaces — still mechanical, but an afternoon, not a minute. Decide
before interface freeze.

## Pending evidence

None — no sibling research overturns taste. Human ratification is the only gate.
