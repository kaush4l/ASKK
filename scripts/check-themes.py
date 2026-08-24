#!/usr/bin/env python3
"""The theme guard (ADE-DESIGN.md §5.5).

A SKIN is a token swap and `check-selectors.py`'s G2 holds it to that. A THEME
is allowed to carry rules — that is how it answers "feel" and not only "look" —
so G2 cannot be the mechanism here, and without one the four new stylesheets
are four new ways to break G1: two themes both restyling `.msg` would put the
same (selector, property) pair in two files, which is the exact defect that
shipped the dashboard broken twice.

The rule that replaces it is narrower and mechanical: **every selector in
`web/theme-<slug>.css` must be prefixed with that theme's own attribute.** Two
themes then cannot collide by construction, because their selector strings
differ in their first token, and no theme can reach a page it was not selected
on.

Two further assertions, both of which a theme has already been caught getting
wrong in the writing of it:

* A theme may not declare `font-size` or a raw spacing literal. Both ceilings
  (six sizes, eight steps) are counted by `check-selectors.py` across every
  file, and a theme's job is to re-point `--t-*` and `--s-*`, never to spend a
  new value out of the shared budget.
* A theme must define the tokens that decide whether it is a LIGHT or a DARK
  page together. `--ink` without `--surface-1` is how an inverted palette ships
  black text on a black card.

Run: scripts/check-themes.py   (exit 1 on any violation)
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

# The pair a light theme has to move together, or it ships unreadable.
GROUND_PAIR = ("--ink", "--surface-1")
SPACE_PROPS = {"padding", "margin", "gap", "row-gap", "column-gap",
               "padding-inline", "padding-block", "margin-inline", "margin-block"}

fails = []
files = sorted(WEB.glob("theme-*.css"))
if not files:
    print("FAIL no web/theme-*.css — ADE-DESIGN.md §4 names four", file=sys.stderr)
    sys.exit(1)


def rules(text):
    """(selector, [(prop, value)]) per rule, comments stripped, at-rules flat."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        sel = " ".join(m.group(1).split())
        if sel.startswith("@") or not sel:
            continue
        decls = []
        for d in m.group(2).split(";"):
            if ":" not in d:
                continue
            prop, _, val = d.partition(":")
            decls.append((prop.strip(), val.strip()))
        yield sel, decls


for path in files:
    slug = path.stem[len("theme-"):]
    marker = f'[data-theme="{slug}"]'
    text = path.read_text()
    declared = set()
    for sel, decls in rules(text):
        for one in sel.split(","):
            one = one.strip()
            if not one:
                continue
            if not one.startswith(f":root{marker}") and not one.startswith(marker):
                fails.append(f"{path.name}: `{one}` is not prefixed with {marker} — "
                             "a theme may not reach a page it was not selected on")
        for prop, val in decls:
            declared.add(prop)
            if prop == "font-size":
                fails.append(f"{path.name}: `{one}` sets font-size — a theme "
                             "re-points --t-*, it does not spend a seventh size")
            if prop in SPACE_PROPS:
                for tok in val.split():
                    if re.fullmatch(r"-?\.?\d+(\.\d+)?(rem|px|em)", tok):
                        fails.append(f"{path.name}: `{one}` sets `{prop}: {tok}` — "
                                     "every space is a --s-* token")
    have = [t for t in GROUND_PAIR if t in declared]
    if have and len(have) != len(GROUND_PAIR):
        missing = [t for t in GROUND_PAIR if t not in declared]
        fails.append(f"{path.name}: declares {', '.join(have)} but not "
                     f"{', '.join(missing)} — the ink and the surface it sits on "
                     "move together or the theme ships unreadable text")

if fails:
    print("\n".join("FAIL " + f for f in fails))
    print(f"\nTHEME CHECK FAILED: {len(fails)}", file=sys.stderr)
    sys.exit(1)
print(f"THEME CHECK OK — {len(files)} themes, "
      f"{', '.join(p.stem[len('theme-'):] for p in files)}")
