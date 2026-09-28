"""Tools belonging to the main agent. Every public function here becomes one of its tools."""

from pathlib import Path

import yaml


def add(a: int, b: int) -> int:
    """Add two numbers and return the sum."""
    return a + b


def multiply(a: int, b: int) -> int:
    """Multiply two numbers and return the product."""
    return a * b


def create_agent(name: str, description: str, instructions: str, lasting: bool = False) -> str:
    """Create a sub-agent of your own: name it, say what it is for, and write its job.

    The description is what you will read when choosing to call it, so write it for
    yourself. The instructions are its whole prompt, so write them for it.

    A lasting agent keeps every call it is ever given, under a session of its own, so it
    can be handed one long goal in pieces and asked later how it went. A fresh one starts
    empty on every call, which is what a task complete in its own words wants. Fresh is
    the default: a clean context is worth more than a remembered one until the job needs
    both.
    """
    if not name.isidentifier():
        return f"{name!r} is not a usable folder name; use letters, digits and underscores"

    folder = Path(__file__).resolve().parent / name
    if (folder / "agent.md").exists():
        return f"an agent named {name!r} already exists; pick another name"

    folder.mkdir(parents=True, exist_ok=True)
    config = {"name": name, "description": description}
    if lasting:
        config |= {"remembers": True, "session": name}
    settings = yaml.safe_dump(config, sort_keys=False)
    (folder / "agent.md").write_text(f"---\n{settings}---\n\n{instructions.strip()}\n")
    kind = "lasting" if lasting else "fresh"
    return f"created the {kind} agent {name!r}; it is yours to call from the next run on"
