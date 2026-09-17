"""REPL — read a query, run the agent, show the run as it happens."""

import asyncio

from core.agents import load_agent
from core.events import Event

SHOWN = {"field": "", "call": "->", "observation": "<-", "answer": "", "error": "!"}


def show(event: Event) -> None:
    """One line per thing that happened. Deltas and reasoning stay quiet here."""
    if event.kind not in SHOWN:
        return
    mark = SHOWN[event.kind]
    label = " ".join(part for part in (mark, event.name) if part)
    print(f"  [{event.agent}] {label + ': ' if label else ''}{event.value}")


async def main() -> None:
    engine = await load_agent("main")
    engine.listen(show)
    print(f"{engine.name} on {engine.inference.model}  (blank line or Ctrl-D to exit)")

    while True:
        try:
            query = (await asyncio.to_thread(input, "\n> ")).strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not query:
            break
        print()
        await engine.invoke(query)


if __name__ == "__main__":
    asyncio.run(main())
