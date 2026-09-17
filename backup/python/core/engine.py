"""Agent engines — a base that does the work, subclasses that supply variables.

    BaseEngine   — render the prompt sheet, take one step, return the answer
    ReActEngine  — loops until the response's action field says "answer"

Name, description and system prompt come from the agent markdown file, so engines are
built through load_agent() rather than constructed by hand:

    engine = await load_agent("main")
    await engine.invoke("hello")

Every call is awaitable, so independent engines run concurrently:

    answers = await asyncio.gather(first.invoke(task), second.invoke(task))

A ReAct step carries its tool calls as stages — [[a, b], [c]] runs a and b together,
then c — so one step can fan out across several tools or sub-agents.
"""

import asyncio
import inspect
import json
import time
from collections.abc import Callable

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .context import BaseContext
from .events import Event, Kind, Progress, Status
from .inference import BaseInference, InferenceError, Multimodal, inference
from .responses import DEFAULT_FORMAT, BaseResponse, Format, ReActResponse
from .sessions import load, save
from .tools import AgentTool, BaseTool


class BaseEngine(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str
    description: str
    system_prompt: str
    soul: str = ""
    inference: BaseInference = Field(default_factory=inference)
    multimodal: Multimodal | None = None
    response_model: type[BaseResponse] = ReActResponse
    response_format: Format = DEFAULT_FORMAT
    tools: list[BaseTool] = []
    context: list[BaseContext] = []
    history: list[dict] = []
    status: Status = "idle"
    goal: str = ""
    steps: int = 0
    started: float = 0.0
    calls: list[str] = []
    compactor: "BaseEngine | None" = None
    compact_at: float = 0.9
    keep: int = 4
    repairs: int = 2
    remembers: bool = False
    session: str = ""
    inbox: asyncio.Queue = Field(default_factory=asyncio.Queue)
    listener: Callable[[Event], Any] | None = None

    def model_post_init(self, __context) -> None:
        """Hand the format to the response class once, and pick up any past to continue."""
        self.response_model = self.response_model.with_format(self.response_format)
        if self.session and not self.history:
            self.history = load(self.session)

    async def render(self) -> str:
        """The whole prompt sheet. Context is gathered now, so it is never stale."""
        turns = "\n\n".join(f"{turn['role']}: {turn['content']}" for turn in self.history)
        tools = "\n".join(tool.instructions() for tool in self.tools)
        present = "\n".join(await asyncio.gather(*(piece.render(self) for piece in self.context)))
        return (
            (f"{self.soul}\n\n" if self.soul else "")
            + f"{self.system_prompt}\n\n"
            + (f"## TOOLS\n\n{tools}\n\n" if tools else "")
            + (f"## CONTEXT\n\n{present}\n\n" if present else "")
            + f"## CONVERSATION\n\n{turns}\n\n"
            + f"{self.response_model.instructions()}"
        )

    def listen(self, listener: Callable[[Event], Any] | None) -> None:
        """Send this agent's events, and every sub-agent's, to one place."""
        self.listener = listener
        for tool in self.tools:
            tool.listen(listener)

    def begin(self, query: str) -> None:
        """Open a turn. The goal is new, so everything measured against it starts again."""
        self.goal, self.steps, self.calls, self.started = query, 0, [], time.monotonic()

    def progress(self) -> Progress:
        """The turn so far, in the fewest fields that answer 'should I step in?'."""
        return Progress(
            status=self.status,
            goal=self.goal,
            steps=self.steps,
            seconds=round(time.monotonic() - self.started, 1) if self.started else 0.0,
            calls=self.calls,
            repeats=len(self.calls) - len(set(self.calls)),
        )

    def nudge(self, note: str) -> None:
        """Say something to a run already under way, without waiting for it to end.

        The note is not delivered now — it is left in the inbox, and the loop picks it up
        before its next step. Anyone holding the engine can leave one: a user watching the
        status, or a lead that has decided its sub-agent is going the wrong way.
        """
        self.inbox.put_nowait(note)

    def heard(self) -> None:
        """Take whatever was said mid-run and make it turns, so the next step reads it.

        A nudge becomes an ordinary user turn. That is the whole trick: the agent needs no
        new instruction for handling interruptions, because an interruption is only the
        user speaking again, which it already knows how to read.
        """
        while not self.inbox.empty():
            self.history.append({"role": "user", "content": self.inbox.get_nowait()})
            self.remember()

    def remember(self) -> None:
        """Keep the history, if this run was given a session to keep it under."""
        if self.session:
            save(self.session, self.history)

    async def enter(self, status: Status) -> None:
        """Say what the agent is doing now. A front end reads the same field the loop sets."""
        self.status = status
        await self.emit("status", value=status)

    async def emit(self, kind: Kind, name: str = "", value: str = "") -> None:
        """Tell the listener, if there is one. Sync or async, it does not matter."""
        if self.listener is None:
            return
        told = self.listener(Event(agent=self.name, kind=kind, name=name, value=value))
        if inspect.isawaitable(told):
            await told

    def as_tool(self) -> AgentTool:
        """Expose this engine as a tool another engine can call."""
        return AgentTool(
            name=self.name,
            description=self.description,
            parameters={"query": "str"},
            engine=self,
            remembers=self.remembers,
        )

    async def compress(self) -> None:
        """Fold the older turns into one summary when the sheet nears the context limit."""
        if self.compactor is None:
            return
        limit = self.compact_at * await self.inference.context()
        if len(self.history) <= self.keep + 1 or self.inference.tokens(await self.render()) <= limit:
            return

        await self.enter("compacting")
        older, self.history = self.history[: -self.keep], self.history[-self.keep :]
        self.history.insert(0, {"role": "summary", "content": await self.summarise(older)})

    async def summarise(self, turns: list[dict]) -> str:
        """Hand the turns to the compactor, which keeps no memory of its own."""
        self.compactor.history = []
        return await self.compactor.invoke(BaseInference.flatten(turns))

    async def step(self) -> BaseResponse:
        """One LLM call, repaired if the reply will not parse. Never raises."""
        await self.compress()
        self.steps += 1
        await self.enter("thinking")
        note, raw = "", ""

        for _ in range(self.repairs + 1):
            try:
                raw = await self.spoken(await self.render() + note)
            except InferenceError as error:
                await self.emit("error", value=str(error))
                return self.response_model.recovered(str(error))
            try:
                return self.response_model.model_validate(raw)
            except ValidationError as error:
                await self.emit("error", value=self.faults(error))
                note = (
                    f"\n\n## YOUR LAST REPLY WAS REJECTED\n\n{self.faults(error)}\n\n"
                    "That reply was not used. Write the whole reply again, in the format above."
                )
        return self.response_model.recovered(raw)

    async def spoken(self, sheet: str) -> str:
        """Stream one reply, announcing each field the moment it is finished."""
        text, shown = "", set()
        async for delta in self.inference.stream(sheet, multimodal=self.multimodal):
            if delta.kind == "reasoning":
                await self.emit("reasoning", value=delta.text)
                continue
            text += delta.text
            await self.emit("delta", value=delta.text)
            shown |= await self.announce(self.response_model.fields(text), shown)

        await self.announce(self.response_model.fields(text, complete=True), shown)
        return text

    async def announce(self, fields: dict, shown: set) -> set:
        """Emit the fields not emitted yet, and say which those were."""
        fresh = {name for name in fields if name not in shown}
        for name in fields:
            if name in fresh:
                await self.emit("field", name, str(fields[name]))
        return fresh

    @staticmethod
    def faults(error: ValidationError) -> str:
        """The validation errors as the model needs to read them: field, then what is wrong."""
        return "\n".join(
            f"- {'.'.join(str(part) for part in fault['loc']) or 'reply'}: {fault['msg']}"
            for fault in error.errors()
        )

    async def invoke(self, query: str) -> str:
        self.begin(query)
        self.history.append({"role": "user", "content": query})
        self.remember()
        response = await self.step()
        self.history.append({"role": "assistant", "content": response.answer})
        self.remember()
        await self.enter("done")
        await self.emit("answer", value=response.answer)
        return response.answer


class ReActEngine(BaseEngine):
    response_model: type[BaseResponse] = ReActResponse
    max_steps: int = 10

    async def act(self, response: BaseResponse) -> str:
        """Run the response's calls: each inner list at once, the lists in order."""
        if not response.calls:
            return "no tool calls given; put them in act or set do to done"

        await self.enter("calling")
        observations = []
        for stage in response.calls:
            results = await asyncio.gather(*(self.call(call) for call in stage))
            for call, result in zip(stage, results):
                await self.emit("observation", call, result)
            observations.extend(f"{call} -> {result}" for call, result in zip(stage, results))
        return "\n".join(observations)

    @staticmethod
    def written(calls: list[list[str]]) -> str:
        """The calls as the agent wrote them, for the conversation record."""
        return " then ".join(", ".join(stage) for stage in calls)

    async def call(self, call: str) -> str:
        """Run one call written as name({"key": "value"})."""
        self.calls.append(call.strip())
        await self.emit("call", value=call.strip())
        name, _, rest = call.strip().partition("(")
        name = name.strip()
        arguments = rest.rpartition(")")[0].strip()

        tool = next((tool for tool in self.tools if tool.name == name), None)
        if tool is None:
            return f"no tool named {name!r}; available: {[tool.name for tool in self.tools]}"

        try:
            return await tool.run(json.loads(arguments) if arguments else {})
        except Exception as error:
            return f"{name} failed: {error}"

    async def invoke(self, query: str) -> str:
        self.begin(query)
        self.history.append({"role": "user", "content": query})
        self.remember()

        while True:
            self.heard()
            response = await self.step()
            spoken = response.answer or self.written(response.calls)
            self.history.append({"role": "assistant", "content": spoken})
            self.remember()

            if response.do == "done":
                await self.enter("done")
                await self.emit("answer", value=response.answer)
                return response.answer

            self.history.append({"role": "observation", "content": await self.act(response)})
            self.remember()

            if len(self.history) > 2 * self.max_steps:
                return response.answer
