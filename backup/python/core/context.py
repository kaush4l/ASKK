"""Context — what is true right now, gathered each time the prompt is rendered.

    context: [time]        # in agent.md frontmatter

The other layers are written once and read back unchanged. Context is not: each piece is
a function that runs at render time, so the agent reads the world as it is on this step
rather than as it was when the agent was loaded.

An agent lists the pieces it wants, in the order it wants them read. Each piece is
handed the engine it is rendering for, so a piece can report the world outside the agent
or the agent's own state.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class BaseContext(BaseModel):
    """One piece of the present, rendered as a line the model can read."""

    async def render(self, engine: Any) -> str:
        raise NotImplementedError("Subclasses must implement render")


class TimeContext(BaseContext):
    """The date and time, as the machine running the agent sees them."""

    format: str = "%A %d %B %Y, %H:%M %Z"

    async def render(self, engine: Any) -> str:
        return f"The time is {datetime.now().astimezone():{self.format}}."


class BudgetContext(BaseContext):
    """How much room is left: steps spent of steps allowed, history against the window.

    An agent that cannot see its own budget cannot spend it well — it explores for nine
    steps and is cut off on the tenth with nothing to show. Stating the budget is the
    cheapest way to let it decide when to stop looking and start answering.
    """

    async def render(self, engine: Any) -> str:
        spent = sum(1 for turn in engine.history if turn["role"] == "assistant")
        allowed = getattr(engine, "max_steps", 0)
        used = engine.inference.tokens(
            "".join(str(turn["content"]) for turn in engine.history)
        )
        window = await engine.inference.context()

        steps = f"This is step {spent + 1} of {allowed}." if allowed else ""
        room = f"The conversation is about {used} tokens of a {window} token window."
        return " ".join(part for part in (steps, room) if part)


CONTEXTS: dict[str, type[BaseContext]] = {
    "time": TimeContext,
    "budget": BudgetContext,
}


def context(name: str, **settings) -> BaseContext:
    """Build the context piece a name asks for."""
    if name not in CONTEXTS:
        raise ValueError(f"unknown context {name!r}; known: {sorted(CONTEXTS)}")
    return CONTEXTS[name](**settings)


def contexts(listed: list[str] | dict[str, dict]) -> list[BaseContext]:
    """The pieces an agent asked for, in the order it asked for them."""
    if isinstance(listed, dict):
        return [context(name, **(settings or {})) for name, settings in listed.items()]
    return [context(name) for name in listed]
