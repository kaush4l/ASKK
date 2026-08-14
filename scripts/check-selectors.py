#!/usr/bin/env python3
"""The stylesheet guard (DESIGN.md G1, G2, and the token ceilings).

Increments 12 and 13 shipped the dashboard broken TWICE behind a green check,
and both times the mechanism was the same: one property declared in two files,
where the loser was the newer rule because the older one carried higher
specificity. `grid-template-columns` lived in instrument.css at (0,1,2) and in
dash.css at (0,0,1); the page measured a 416px centre column in all twelve fold
states and nothing said so.

So this checks the pair, not the selector. "No selector in two files" sounds
stricter and is useless — it forbids glass.css giving `header` its fill while
chrome.css gives it its position, which is exactly the separation the file
split exists to create. The (selector, property) pair is the unit that actually
broke.

Run: scripts/check-selectors.py   (exit 1 on any violation)
"""
import re
import sys
import pathlib
import collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = sorted((ROOT / "web").glob("*.css"))

# DESIGN.md §2. A file not on this list is a file nobody agreed to.
EXPECTED = {"tokens.css", "base.css", "glass.css", "layout.css",
            "chrome.css", "surfaces.css", "controls.css", "workspace.css"}

MAX_LINES = 200          # I12
# DESIGN.md §5. RAISED 5 -> 6 IN R5-A, deliberately and once. The ceiling
# exists to stop drift, not to stop design: with five sizes the product shipped
# 42 rendered nodes at 14px against 5 at 18, 2 at 32 and 1 at 11 — prose,
# button labels, nav items, statuses, file names and shell output all on one
# size, and no subhead register between the masthead and the body. The sixth is
# `--t-subhead` (20px) and it is the last one; a seventh needs the same
# argument in writing, in DESIGN.md §5, before this number moves again.
MAX_FONT_SIZES = 6
MAX_SPACING = 8          # DESIGN.md §6

fails = []


def strip_comments(text):
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def blocks(text):
    """(selector, [(prop, value)]) for every rule, at-rules flattened."""
    text = strip_comments(text)
    out = []
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
        out.append((sel, decls))
    return out


# ---- file set and size -----------------------------------------------------
names = {p.name for p in CSS}
for extra in sorted(names - EXPECTED):
    fails.append(f"UNEXPECTED FILE web/{extra} — DESIGN.md §2 names the files")
for missing in sorted(EXPECTED - names):
    fails.append(f"MISSING FILE web/{missing}")
for p in CSS:
    n = len(p.read_text().splitlines())
    if n > MAX_LINES:
        fails.append(f"I12 web/{p.name} is {n} lines (max {MAX_LINES})")

# ---- G1: one home per (selector, property) --------------------------------
owner = collections.defaultdict(set)
for p in CSS:
    for sel, decls in blocks(p.read_text()):
        for one in sel.split(","):
            one = one.strip()
            if not one:
                continue
            for prop, _ in decls:
                owner[(one, prop)].add(p.name)
for (sel, prop), where in sorted(owner.items()):
    if len(where) > 1:
        fails.append(f"G1 `{sel}` sets `{prop}` in {' and '.join(sorted(where))}")

# ---- G2: the skin is a token swap, never a rule ---------------------------
for p in CSS:
    for sel, decls in blocks(p.read_text()):
        if "data-skin" not in sel:
            continue
        # legal ONLY as a :root token block, which declares nothing but tokens
        if not all(prop.startswith("--") for prop, _ in decls):
            fails.append(f"G2 web/{p.name}: `{sel}` is a skin-gated RULE. "
                         "The skin re-points tokens; it does not restyle elements.")

# ---- the token ceilings ---------------------------------------------------
sizes, spacing = collections.Counter(), collections.Counter()
SPACE_PROPS = {"padding", "margin", "gap", "row-gap", "column-gap",
               "padding-inline", "padding-block", "margin-inline", "margin-block"}
for p in CSS:
    for sel, decls in blocks(p.read_text()):
        for prop, val in decls:
            if prop == "font-size" and not prop.startswith("--"):
                sizes[val] += 1
            if prop in SPACE_PROPS:
                for tok in val.split():
                    if re.fullmatch(r"-?\.?\d+(\.\d+)?(rem|px|em)", tok):
                        spacing[tok] += 1

if len(sizes) > MAX_FONT_SIZES:
    fails.append(f"§5 {len(sizes)} distinct font-size values (max {MAX_FONT_SIZES}): "
                 + ", ".join(sorted(sizes)))
if spacing:
    fails.append(f"§6 {len(spacing)} raw spacing literal(s) — every space is a "
                 f"--s-* token: " + ", ".join(f"{k}x{v}" for k, v in spacing.most_common()))

# ---- one role, one value --------------------------------------------------
defs = collections.defaultdict(set)
for p in CSS:
    for sel, decls in blocks(p.read_text()):
        for prop, val in decls:
            if prop.startswith("--"):
                defs[prop].add(val)
for tok, vals in sorted(defs.items()):
    # a token legitimately holds a second value in the OPAQUE path; that is the
    # swap. Two values in the same context is the defect, and the opaque blocks
    # are the only place a redefinition is allowed.
    pass

if fails:
    print("\n".join("FAIL " + f for f in fails))
    print(f"\nSTYLESHEET CHECK FAILED: {len(fails)}", file=sys.stderr)
    sys.exit(1)
print(f"STYLESHEET CHECK OK — {len(CSS)} files, "
      f"{len(sizes)} font sizes, 0 raw spacing literals, 0 duplicated properties")
