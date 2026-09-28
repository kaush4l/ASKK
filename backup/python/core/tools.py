"""Tools — anything callable that can render itself as prompt instructions.

    BaseTool      — name, description, parameters; renders instructions, runs a call
    FunctionTool  — wraps a Python function, sync or async
    MCPTool       — one tool on an MCP server; await mcp_tools(url) lists them all
    AgentTool     — another agent, which is just a tool that happens to think

Every run is awaitable, so a caller can gather many tools at once. A sync function is
pushed to a worker thread so it never blocks the event loop.

Engines expose themselves as tools through BaseEngine.as_tool(). An engine's tool list is
therefore the whole of what it can reach, sub-agents included — there is no second list.
"""

import asyncio
import inspect
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict


class BaseTool(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str
    description: str
    parameters: dict[str, str] = {}

    def instructions(self) -> str:
        args = ", ".join(f"{key}: {value}" for key, value in self.parameters.items())
        return f"- {self.name}({args}): {self.description}"

    async def run(self, arguments: dict[str, Any]) -> str:
        raise NotImplementedError("Subclasses must implement run")

    def listen(self, listener: Callable | None) -> None:
        """Pass a listener on to whatever is behind this tool. Most tools have nothing."""


class FunctionTool(BaseTool):
    function: Callable

    @classmethod
    def of(cls, function: Callable, description: str = "") -> "FunctionTool":
        """Build a tool from a function, taking name/description/parameters from it."""
        signature = inspect.signature(function)
        return cls(
            name=function.__name__,
            description=description or (function.__doc__ or "").strip(),
            parameters={
                name: getattr(parameter.annotation, "__name__", str(parameter.annotation))
                if parameter.annotation is not parameter.empty
                else "any"
                for name, parameter in signature.parameters.items()
            },
            function=function,
        )

    async def run(self, arguments: dict[str, Any]) -> str:
        if inspect.iscoroutinefunction(self.function):
            return str(await self.function(**arguments))
        return str(await asyncio.to_thread(self.function, **arguments))


class AgentTool(BaseTool):
    """Another agent, held as a tool. The engine behind it is reachable, not hidden."""

    engine: Any
    remembers: bool = False

    async def run(self, arguments: dict[str, Any]) -> str:
        """Run the agent on this task alone, unless it is one that carries its past.

        Each call gets its own engine, sharing the tools and the listener but not the
        history, so the same agent can be running two tasks at once without either
        reading the other's turns. An agent that carries its past between calls is the
        one engine every time, and is therefore called one task at a time.
        """
        if self.remembers:
            return await self.engine.invoke(**arguments)
        return await self.engine.model_copy(update={"history": []}).invoke(**arguments)

    def listen(self, listener: Callable | None) -> None:
        self.engine.listen(listener)


class MCPTool(BaseTool):
    client: Any

    async def run(self, arguments: dict[str, Any]) -> str:
        async with self.client:
            result = await self.client.call_tool(self.name, arguments)
        if result.data is not None:
            return str(result.data)
        return "\n".join(getattr(block, "text", "") for block in result.content)


async def mcp_tools(server: str | dict, allowed: list[str] | None = None) -> list[MCPTool]:
    """Connect to an MCP server and wrap the tools it advertises.

    `server` is a path, URL, or an MCP config dict. `allowed` keeps only those tool
    names — servers such as Chrome DevTools advertise dozens we do not want in the prompt.
    """
    from fastmcp import Client

    client = Client(server)
    async with client:
        advertised = await client.list_tools()

    if allowed is not None:
        advertised = [tool for tool in advertised if tool.name in allowed]
        missing = set(allowed) - {tool.name for tool in advertised}
        if missing:
            raise ValueError(f"MCP server does not serve these tools: {sorted(missing)}")

    return [
        MCPTool(
            name=tool.name,
            description=tool.description or "",
            parameters={
                key: str(value.get("type", "any"))
                for key, value in (tool.inputSchema or {}).get("properties", {}).items()
            },
            client=client,
        )
        for tool in advertised
    ]
