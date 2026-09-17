"""The soul — the character an agent brings to whatever job it is given.

    soul()                           # the project's soul.md
    soul(AGENTS_DIR / "chrome")      # that agent's own soul.md, if it has one

Where the agent markdown says what this agent does, the soul says who it is: how it
thinks, how it speaks, what it holds to, where it stops. It is project-wide, so one
file at the head of the agents folder serves every agent, and an agent overrides it
only by keeping a soul.md of its own beside its agent.md. It is rendered first, ahead
of everything else.
"""

from pathlib import Path

from .markdown import read

SOUL_FILE = Path(__file__).resolve().parent.parent / "agents" / "soul.md"


def soul(folder: Path | None = None) -> str:
    """The agent's own soul if it has one, otherwise the project's, otherwise nothing."""
    for path in ((folder / "soul.md",) if folder else ()) + (SOUL_FILE,):
        if path.is_file():
            return read(path)[1]
    return ""
