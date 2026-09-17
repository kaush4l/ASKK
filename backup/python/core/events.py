"""Events — what an agent is doing, while it is still doing it.

    engine.listen(print)          # anything callable, sync or async
    await engine.invoke(query)    # events arrive as the run happens

Nothing in the loop depends on a listener being there. Events are how a front end sees
a run without reaching into the engine; with no listener the engine is silent and the
run is unchanged.
"""

from typing import Literal

from pydantic import BaseModel

Kind = Literal[
    "status", "reasoning", "delta", "field", "call", "observation", "answer", "error"
]
Status = Literal["idle", "thinking", "calling", "compacting", "done"]


class Progress(BaseModel):
    """How a turn is going, measured rather than asked for.

    `status` is what the agent is doing this second; the rest is what it has got done
    since the turn began, which is the different question you have when deciding whether
    to leave a long run alone. Every field is read off the run itself, so it costs no
    tokens and cannot flatter the way a self-report can.

    `repeats` is the one to watch. An agent making a call it has already made is going in
    a circle, and a circle is the failure that looks most like work.
    """

    status: Status = "idle"
    goal: str = ""
    steps: int = 0
    seconds: float = 0.0
    calls: list[str] = []
    repeats: int = 0


class Event(BaseModel):
    """One thing that happened, named by the agent it happened in."""

    agent: str
    kind: Kind
    name: str = ""
    value: str = ""
