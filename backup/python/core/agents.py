"""Agent definitions live in markdown — YAML frontmatter for config, body for the prompt.

    agents/main/agent.md  ->  await load_agent("main")  ->  ReActEngine

An agent keeps its own folder, so it can hold more than configuration: a tools.py
beside agent.md is loaded, and every public function in it becomes one of its tools, and
a soul.md beside it replaces the project's soul for that agent alone.

Frontmatter keys that name an Inference field (model, base_url, api_key, temperature,
max_output_tokens) configure the inference, and `provider` picks which one. A `model:` may
name an alias from models.json, and with no model at all the catalogue default is used.
Two keys are wiring rather than settings:

    mcp:      MCP servers to connect, each with the subset of tools to expose
    agents:   other agents at the head level, shared, attached as tools
    context:  pieces of the present to gather at render time, in the order given

A folder inside an agent's folder is an agent of its own, and is attached without being
named: what is physically inside you is yours. The tree is the org chart, so a new
sub-agent is a new folder with an agent.md in it and nothing else to register.

Everything else is passed straight to the engine.
"""

import asyncio
import importlib.util
import inspect
import warnings
from pathlib import Path

from .context import contexts
from .engine import BaseEngine, ReActEngine
from .inference import inference
from .markdown import read
from .models import INFERENCE_KEYS, resolve
from .soul import soul
from .tools import BaseTool, FunctionTool, mcp_tools

AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"
COMPACTOR = "compactor"


async def load_agent(name: str = "main", engine_model: type[BaseEngine] = ReActEngine) -> BaseEngine:
    """Read an agent markdown file and build the engine it describes."""
    path = Path(name) if name.endswith(".md") else AGENTS_DIR / name / "agent.md"
    settings, body = read(path)
    engine_fields = set(engine_model.model_fields)
    provider, llm = resolve(
        {
            key: settings.pop(key)
            for key in list(settings)
            if key not in engine_fields and key in INFERENCE_KEYS
        }
    )
    servers = settings.pop("mcp", {})
    names = settings.pop("agents", [])
    present = contexts(settings.pop("context", []))

    tools = await asyncio.gather(
        *(_server_tools(server, config) for server, config in servers.items()),
        *(load_agent(child, engine_model) for child in names),
        *(load_agent(str(child), engine_model) for child in _owned(path.parent)),
    )

    engine = engine_model(
        soul=soul(path.parent),
        system_prompt=body,
        context=present,
        inference=inference(provider, **llm),
        tools=_local_tools(path.parent) + [tool for group in tools for tool in _as_tools(group)],
        **settings,
    )
    engine.compactor = await _compactor(path.parent.name)
    return engine


def _owned(folder: Path) -> list[Path]:
    """The agent.md of every folder inside this one — sub-agents this agent alone holds."""
    return sorted(
        child / "agent.md" for child in folder.iterdir() if (child / "agent.md").is_file()
    )


async def _compactor(agent: str) -> BaseEngine | None:
    """The agent that summarises history when it grows too long — never its own."""
    if agent == COMPACTOR or not (AGENTS_DIR / COMPACTOR / "agent.md").is_file():
        return None
    return await load_agent(COMPACTOR, BaseEngine)


def _local_tools(folder: Path) -> list[BaseTool]:
    """Public functions in the agent's own tools.py, wrapped as its tools."""
    module_path = folder / "tools.py"
    if not module_path.is_file():
        return []

    spec = importlib.util.spec_from_file_location(f"{folder.name}_tools", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return [
        FunctionTool.of(function)
        for function_name, function in vars(module).items()
        if not function_name.startswith("_")
        and inspect.isfunction(function)
        and function.__module__ == module.__name__
    ]


async def _server_tools(server: str, config: dict) -> list[BaseTool]:
    """Connect one MCP server, keeping only the tools its `tools:` list approves.

    A server that will not start is an outside process failing, not a mistake in the
    agent: the agent loads without those tools rather than not loading at all.
    """
    config = dict(config)
    allowed = config.pop("tools", None)
    try:
        return await mcp_tools({"mcpServers": {server: config}}, allowed)
    except Exception as error:
        warnings.warn(f"mcp server {server!r} gave no tools: {error}")
        return []


def _as_tools(group: list[BaseTool] | BaseEngine) -> list[BaseTool]:
    return group if isinstance(group, list) else [group.as_tool()]
