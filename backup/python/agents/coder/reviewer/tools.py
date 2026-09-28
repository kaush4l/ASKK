"""The reviewer's reach: read and list, and nothing else.

The path rule lives in the coder's tools.py and is loaded from there rather than written
again, so there is one place where "inside the workspace" is decided.

What is missing here is the point. The reviewer has no way to write a file and no way to
run a command, so it cannot quietly fix what it was asked to report on. An agent's tool
list is the honest statement of what it does, and this one says: reads, reports, leaves.
"""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "coder_workspace", Path(__file__).resolve().parent.parent / "tools.py"
)
_workspace = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_workspace)


def list_files(path: str = ".") -> str:
    """List the files and folders at a path in the workspace."""
    return _workspace.list_files(path)


def read_file(path: str) -> str:
    """Read a file in the workspace, with a line number against every line."""
    return _workspace.read_file(path)
