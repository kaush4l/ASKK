"""Watch — run an agent on one task and show what it is doing while it does it.

    python watch.py coder "write a script that prints the first 20 primes, and run it"

The REPL in main.py shows the run as a list of things that have happened. This shows the
run as a state: one line, rewritten, saying where the agent is now. They answer different
questions — what happened, and what is happening — and a long run needs the second one,
because by the time a list is long enough to be complete it is too long to read.

The header comes from engine.progress(), which is measured off the run rather than
reported by it, so watching costs nothing and cannot flatter.
"""

import asyncio
import sys

from core.agents import load_agent
from core.events import Event

LOUD = {"call": "->", "observation": "<-", "error": "!"}


def show(event: Event) -> None:
    """Print the events worth a line of their own, under the header."""
    if event.kind in LOUD:
        value = event.value.replace("\n", " ")[:100]
        print(f"\r  [{event.agent}] {LOUD[event.kind]} {value}".ljust(120))


async def watch(engine) -> None:
    """Rewrite one status line until the run is over."""
    while True:
        now = engine.progress()
        spin = f"{now.status:<10} step {now.steps:<3} {now.seconds:>6.1f}s"
        doing = now.calls[-1].replace("\n", " ")[:50] if now.calls else ""
        alarm = f"  REPEATS x{now.repeats}" if now.repeats else ""
        print(f"\r  {spin}  {doing}{alarm}".ljust(120), end="", flush=True)
        await asyncio.sleep(0.4)


async def main() -> None:
    name, task = sys.argv[1], sys.argv[2]
    engine = await load_agent(name)
    engine.listen(show)
    print(f"{engine.name} on {engine.inference.model}\n  {task}\n")

    watcher = asyncio.create_task(watch(engine))
    answer = await engine.invoke(task)
    watcher.cancel()

    print(f"\r{' ' * 120}\r\n{answer}\n")
    print(f"  {engine.progress().steps} steps, {engine.progress().seconds}s")


if __name__ == "__main__":
    asyncio.run(main())
