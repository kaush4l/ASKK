"""Markdown with YAML frontmatter — the format agents and skills are both written in."""

from pathlib import Path

import yaml

STRUCTURE = ("-", "*", "#", ">", "|", "`")


def read(path: Path) -> tuple[dict, str]:
    """Split a markdown file into its frontmatter settings and its body."""
    text = path.read_text()
    if not text.startswith("---"):
        return {}, unwrap(text.strip())
    _, frontmatter, body = text.split("---", 2)
    return yaml.safe_load(frontmatter) or {}, unwrap(body.strip())


def unwrap(text: str) -> str:
    """Every paragraph on one line.

    A file is wrapped so a person can read it; the model pays a token per break and
    gets nothing back. Lines that begin a list, heading or quote keep their own line,
    since there the break is the meaning.
    """
    blocks = []
    for block in text.split("\n\n"):
        lines: list[str] = []
        for line in block.splitlines():
            if lines and not line.lstrip().startswith(STRUCTURE):
                lines[-1] += " " + line.strip()
            else:
                lines.append(line.rstrip())
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)
