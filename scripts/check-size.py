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

BOTH HALVES OF I12 ARE GATED. The file rule is absolute: no file over 200
lines, ever. The function rule is gated against a checked-in baseline,
`scripts/function-baseline.txt`, which lists every function already over 40
lines at the moment the gate was turned on. A function over 40 lines that is
NOT in the baseline fails the run, so the debt cannot grow. A baseline entry
that no longer violates ALSO fails the run, with instructions to delete the
line — which is what makes the baseline shrink-only: `--bless` will remove
entries and refuses to add them.

The baseline is keyed on `path::name`, not on a line number, because line
numbers churn on every edit and a gate that fails on unrelated churn gets
disabled. The cost of that choice is real and worth stating: renaming a file
or a function drops its entry, and the function then reads as new debt. That
is the correct default — a rename is a chance to fix it — but it means a
large structural move must be followed by a deliberate re-blessing.

`--functions` lists every offender, baseline or not, and is the report the
next person shrinking this list should read.

Exit 0 = I12 holds for Rust: the file rule outright, the function rule against
a baseline that only shrinks. Any violation exits 1.
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


BASELINE = ROOT / "scripts" / "function-baseline.txt"


def read_baseline() -> set:
    """The `path::name` keys of functions allowed to remain over 40 lines."""
    if not BASELINE.exists():
        return set()
    return {
        line.strip()
        for line in BASELINE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }


def offenders(files):
    """`{path::name}` -> longest span, for every function over MAX_FN."""
    found = {}
    for path in files:
        rel = path.relative_to(ROOT)
        for line, name, length in long_fns(path, path.read_text(encoding="utf-8")):
            key = f"{rel}::{name}"
            found[key] = max(found.get(key, 0), length)
    return found


def bless(files) -> int:
    """Rewrite the baseline, removing fixed entries and REFUSING to add new ones.

    The one exception is the file's first creation — turning the gate on has to
    start somewhere. After that the list only shrinks.
    """
    current, allowed = offenders(files), read_baseline()
    first_time = not BASELINE.exists()
    added = [] if first_time else sorted(set(current) - allowed)
    if first_time:
        allowed = set(current)
    if added:
        print("REFUSING to bless: these are new violations, not existing debt.")
        for key in added:
            print(f"  {key} ({current[key]} lines)")
        print("Shrink them, or shrink something else first. The baseline only shrinks.")
        return 1
    kept = sorted(set(current) & allowed)
    BASELINE.write_text(
        "# Functions over 40 lines (I12) that predate the gate. This list only\n"
        "# shrinks: `--bless` removes fixed entries and refuses to add new ones.\n"
        + "".join(f"{key}\n" for key in kept),
        encoding="utf-8",
    )
    print(f"blessed: {len(allowed)} -> {len(kept)} baselined functions")
    return 0


def main():
    functions = "--functions" in sys.argv[1:]
    files = sorted(p for p in ROOT.glob("crates/*/src/**/*.rs"))
    if not files:
        print("FAIL: no Rust sources found under crates/*/src")
        return 1
    if "--bless" in sys.argv[1:]:
        return bless(files)

    failures = []
    for path in files:
        src = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        count = lines_in(src)
        if count > MAX_FILE:
            failures.append(f"{rel}: {count} lines (max {MAX_FILE})")

    current = offenders(files)
    if functions:
        # Report mode: every offender, baselined or not.
        for key in sorted(current):
            path, name = key.rsplit("::", 1)
            failures.append(f"{path}: fn {name} is {current[key]} lines (max {MAX_FN})")
    else:
        allowed = read_baseline()
        for key in sorted(set(current) - allowed):
            path, name = key.rsplit("::", 1)
            failures.append(
                f"{path}: fn {name} is {current[key]} lines (max {MAX_FN}) "
                f"— NEW. Shrink it; the baseline does not grow."
            )
        for key in sorted(allowed - set(current)):
            failures.append(
                f"{key} is no longer over {MAX_FN} lines — delete its line from "
                f"{BASELINE.relative_to(ROOT)} (or run --bless)."
            )

    if failures:
        print("I12 SIZE CHECK FAILED")
        for f in failures:
            print(f"  {f}")
        return 1

    widest = max(lines_in(p.read_text(encoding="utf-8")) for p in files)
    baselined = len(read_baseline())
    print(
        f"size OK: {len(files)} files under crates/*/src, longest {widest} lines; "
        f"no function over {MAX_FN} lines outside the {baselined}-entry baseline"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
