"""Sessions — an agent's history on disk, so a conversation outlives the process.

    engine.session = "monday"     # names the file; no name, nothing is written
    engine.history = load("monday")

History is the only layer written by the run rather than by us, so it is the only one
worth saving. Everything else — soul, job, tools, context — is rebuilt from the files
each time and would be stale the moment either changed.

The file is rewritten after every turn rather than at the end, because a run that
crashes on step nine is exactly the run whose history you wanted.
"""

import json
from pathlib import Path

SESSIONS_DIR = Path(__file__).resolve().parent.parent / "sessions"


def path(session: str) -> Path:
    """Where a named session is kept."""
    return SESSIONS_DIR / f"{session}.json"


def save(session: str, history: list[dict]) -> None:
    """Write the history, replacing whatever was there."""
    SESSIONS_DIR.mkdir(exist_ok=True)
    path(session).write_text(json.dumps(history, indent=2))


def load(session: str) -> list[dict]:
    """The history of a past session, or nothing if it is a session that never ran."""
    file = path(session)
    return json.loads(file.read_text()) if file.is_file() else []


def sessions() -> list[str]:
    """Every session on disk, newest first."""
    if not SESSIONS_DIR.is_dir():
        return []
    files = sorted(SESSIONS_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
    return [file.stem for file in files]
