"""Skills — written instructions kept out of the prompt until they are asked for.

    catalogue()              # [{"name": ..., "description": ...}, ...] for every skill
    load("browsing")         # the full text of one skill
    load("browsing", "sql")  # the full text of several

A skill is skills/<name>.md, or skills/<name>/skill.md when it keeps files beside it.
Not wired into the engine yet.
"""

from pathlib import Path

from .markdown import read

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


def paths() -> dict[str, Path]:
    """Every skill on disk, by name."""
    found = {}
    for path in sorted(SKILLS_DIR.glob("*.md")) + sorted(SKILLS_DIR.glob("*/skill.md")):
        settings, _ = read(path)
        found[settings.get("name") or path.stem] = path
    return found


def catalogue() -> list[dict]:
    """The name and description of every skill, for deciding which ones to load."""
    listed = []
    for name, path in paths().items():
        settings, _ = read(path)
        listed.append({"name": name, "description": settings.get("description", "")})
    return listed


def load(*names: str) -> str:
    """The full text of the named skills."""
    available = paths()
    texts = []
    for name in names:
        if name not in available:
            raise ValueError(f"unknown skill {name!r}; known: {sorted(available)}")
        texts.append(read(available[name])[1])
    return "\n\n".join(texts)
