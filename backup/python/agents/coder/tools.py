"""Tools for working on code: read it, write it, list it, run it.

Every path is taken as relative to `workspace/` and resolved inside it. A path that
climbs out — `../`, an absolute path, a symlink pointing away — is refused rather than
clamped, because a tool that silently rewrites what it was asked to do teaches the agent
the wrong lesson about what it is allowed to touch.

That one rule is the whole safety story here. The agent has a shell, so the directory is
the boundary, and there is no second line of defence behind it.
"""

import subprocess
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parent.parent.parent / "workspace"


def _inside(path: str) -> Path:
    """The real location of a workspace path, or an error if it is not in the workspace."""
    WORKSPACE.mkdir(exist_ok=True)
    resolved = (WORKSPACE / path).resolve()
    if resolved != WORKSPACE and WORKSPACE not in resolved.parents:
        raise ValueError(f"{path!r} is outside the workspace; stay inside it")
    return resolved


def list_files(path: str = ".") -> str:
    """List the files and folders at a path in the workspace. Start here."""
    try:
        folder = _inside(path)
    except ValueError as error:
        return str(error)
    if not folder.is_dir():
        return f"{path!r} is not a folder"
    names = sorted(
        f"{child.name}/" if child.is_dir() else child.name
        for child in folder.iterdir()
        if not child.name.startswith(".")
    )
    return "\n".join(names) if names else "(empty)"


def read_file(path: str) -> str:
    """Read a file in the workspace, with a line number against every line."""
    try:
        file = _inside(path)
    except ValueError as error:
        return str(error)
    if not file.is_file():
        return f"no file at {path!r}; list_files first to see what is there"
    lines = file.read_text().splitlines()
    return "\n".join(f"{number:>4}  {line}" for number, line in enumerate(lines, 1))


def write_file(path: str, content: str) -> str:
    """Write a file in the workspace, replacing it if it is already there.

    The whole file, every time. There is no patch tool, because a patch that does not
    apply leaves you guessing about what the file now says, and guessing is the expensive
    part. Read the file, decide, write it back.
    """
    try:
        file = _inside(path)
    except ValueError as error:
        return str(error)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)
    return f"wrote {path!r}, {len(content.splitlines())} lines"


def run(command: str) -> str:
    """Run a shell command inside the workspace and return what it printed.

    Output and errors come back together, with the exit status, because a command that
    failed is telling you something and the agent should read it rather than be shielded
    from it. A command still running after two minutes is killed.
    """
    WORKSPACE.mkdir(exist_ok=True)
    try:
        done = subprocess.run(
            command,
            shell=True,
            cwd=WORKSPACE,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return f"{command!r} was still running after 120s and was killed"
    output = (done.stdout + done.stderr).strip()
    return f"exit {done.returncode}\n{output}" if output else f"exit {done.returncode} (no output)"
