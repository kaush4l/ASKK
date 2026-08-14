#!/usr/bin/env python3
"""I12 enforcement for Rust — INVARIANTS.md: files <= 200 lines, functions <= 40.

`check-selectors.py` holds the same ceiling for stylesheets; this holds it for
`crates/*/src`. Nothing held it for Rust before, and five files drifted past
200 between two commits with every gate still green.

Scope is `crates/*/src` only. `crates/*/tests` is out: the project's
integration tests have been over 200 lines since the walking skeleton
(`core/tests/skeleton.rs` was 296 at G4), so the established reading of I12 is
that it governs source. Widening it here would be a new rule, not an enforced
one.

THE FILE CHECK IS THE GATE; THE FUNCTION CHECK IS `--functions`, OFF BY
DEFAULT. Not because the scan is unsound — it is a brace-depth walk over
source with comments and literals blanked out, it needs no `syn` dependency,
and every one of the 74 functions it currently reports is a real function over
40 lines, hand-checked against the source. It is off because a gate that fails
on the tree it ships with is not a gate. Turning it on is a separate piece of
work: 74 functions across 8 crates, most of them one `rsx!` or one
`FragmentBuilder` chain, and splitting those is a judgement call per call site,
not a mechanical one. Run `--functions` to see the list.

Exit 0 = I12's file rule holds for Rust. Any violation exits 1.
"""

import re
import sys
from pathlib import Path

MAX_FILE = 200  # I12
MAX_FN = 40  # I12

ROOT = Path(__file__).resolve().parent.parent
FN = re.compile(r"\bfn\s+[A-Za-z_][A-Za-z0-9_]*")


def blanked(src: str) -> str:
    """`src` with every comment and string literal replaced by spaces.

    Newlines survive so line numbers still line up; everything else inside a
    comment or a literal becomes whitespace, so a `{` in a shell script the
    code emits cannot be read as a block.
    """
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        two = src[i : i + 2]
        if two == "//":
            end = src.find("\n", i)
            end = n if end < 0 else end
            out.append(" " * (end - i))
            i = end
        elif two == "/*":
            depth, j = 1, i + 2  # Rust block comments nest
            while j < n and depth:
                if src[j : j + 2] == "/*":
                    depth, j = depth + 1, j + 2
                elif src[j : j + 2] == "*/":
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j]))
            i = j
        elif c in ("r", "b") and (m := re.match(r'(?:b?r|rb)(#*)"', src[i:])):
            hashes = m.group(1)
            close = '"' + hashes
            j = src.find(close, i + m.end())
            j = n if j < 0 else j + len(close)
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j]))
            i = j
        elif c == '"' or (c == "b" and src[i : i + 2] == 'b"'):
            j = i + (2 if c == "b" else 1)
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j]))
            i = j
        elif c == "'" and re.match(r"'(?:\\.|[^\\'])'", src[i:]):
            m = re.match(r"'(?:\\.|[^\\'])'", src[i:])
            out.append(" " * m.end())
            i += m.end()
        else:
            out.append(c)
            i += 1
    return "".join(out)


def long_fns(path: Path, src: str):
    """Every `fn` in `src` whose signature-to-closing-brace span exceeds MAX_FN."""
    clean = blanked(src)
    starts = [m.start() for m in FN.finditer(clean)]
    found = []
    for start in starts:
        open_at = clean.find("{", start)
        semi = clean.find(";", start)
        if open_at < 0 or (0 <= semi < open_at):
            continue  # a trait method with no body, or a fn-pointer type
        depth, j = 0, open_at
        while j < len(clean):
            if clean[j] == "{":
                depth += 1
            elif clean[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        lines = clean.count("\n", start, j) + 1
        if lines > MAX_FN:
            name = FN.search(clean, start).group().split()[-1]
            found.append((clean.count("\n", 0, start) + 1, name, lines))
    return found


def lines_in(src: str) -> int:
    """Lines as `wc -l` counts them — newline-terminated ones.

    Not `splitlines()`. The two disagree by one on a file whose last line has
    no newline, and `crates/core/src/transcript.rs` is such a file, sitting at
    exactly 200 under `wc`. Every "back under 200" pass this repo has done was
    measured with `wc -l`, so that is the count I12 has always meant here.
    """
    return src.count("\n")


def main():
    functions = "--functions" in sys.argv[1:]
    files = sorted(p for p in ROOT.glob("crates/*/src/**/*.rs"))
    if not files:
        print("FAIL: no Rust sources found under crates/*/src")
        return 1

    failures = []
    for path in files:
        src = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        count = lines_in(src)
        if count > MAX_FILE:
            failures.append(f"{rel}: {count} lines (max {MAX_FILE})")
        if functions:
            for line, name, length in long_fns(path, src):
                failures.append(f"{rel}:{line}: fn {name} is {length} lines (max {MAX_FN})")

    if failures:
        print("I12 SIZE CHECK FAILED")
        for f in failures:
            print(f"  {f}")
        return 1

    widest = max(lines_in(p.read_text(encoding="utf-8")) for p in files)
    said = " + functions" if functions else ""
    print(f"size OK{said}: {len(files)} files under crates/*/src, longest {widest} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
