# Found in the Python

Defects and surprises the port turned up in the source it was porting. A port
reads a codebase more carefully than anything else does, and this is what fell
out. Nothing here was fixed silently: each row says whether the JavaScript
reproduces the behaviour or diverges, and why.

The rule was **reproduce, and record**. A port that quietly corrects its source
cannot be checked against it, and the golden fixtures would stop meaning
anything. Where a row says *diverges*, it is because reproducing was impossible
or because `PORT-MAP.md` already ruled on it.

---

## Reproduced, deliberately

| # | Where | What | Why it was kept |
|---|---|---|---|
| P-1 | `tools.py:98` `Tool.from_engine` | the goal rescue does `str(value or "")` over every extra argument, so `{"task": {"goal": "x"}}` starts a sub-agent on the string `{'goal': 'x'}` — and `{"task": 0}` is **refused**, because Python calls `0` empty | changing it changes what a sub-agent receives; that is a ruling, not a port. It is reproduced by `core/py-str.js`, not by `String(v ?? "")` — `??` guards only null, so every falsy extra argument started a sub-agent instead of being skipped |
| P-2 | `tools.py:267` `Toolbox.invoke` | the no-calls-found message renders a **list repr** when `text` is a list, because `parse_batches` joins first and the error message does not. The repr is built **then** cut to 120, so the cut lands inside a quoted item | the model reads this string; the byte rule forbids improving it. `String(array)` is not that repr — `core/py-str.js` is |
| P-3 | `inference.py:157` `OpenAICompatible._content` | `split_data_url` runs on **remote** audio URLs too, so a remote `.wav` is sent as `{data: "", format: ""}` — silently empty audio. Images and video take the URL directly; only audio has the hole | a real bug, but fixing it changes the wire. Its own increment |
| P-4 | `skills.py:76` `load_skills` | the `.md` suffix filter applies only to non-directories, so a directory named `notes.txt/` is treated as a skill folder and warned about as missing its `SKILL.md` | harmless; the warning just reads oddly |
| P-5 | `session.py:71` `reset_for` | clears plan, step results, critiques and round — but **not `skills`**. Loaded skills leak from one user turn to the next | plausibly intentional (a skill chosen for a task may still apply), but it is not stated anywhere |
| P-6 | `memory.py:177` `compact` | the docstring says `keep` "must not be zero" and nothing enforces it. `compact(summarizer, 0)` summarises away the question just asked — exactly the failure the docstring warns of | a guard is a behaviour change |
| P-7 | `memory.py:139` `_rewrite_log` | drains, then replaces. An `add()` landing in that window is lost from the file — it survives in memory and reappears below the summary on the next append | single-threaded in practice, but nothing states the assumption |
| P-8 | `assembler.py:73` `_check` | reads `ordered[-1]` unguarded. On an empty list that is an `IndexError`, not an `AssemblyError`. Unreachable only because the zero-RESPONSE check fires first — an undocumented ordering dependency between two checks | the JS has the same shape, so the dependency is preserved rather than papered over |
| P-9 | `inference.py:204` `AnthropicCompatible` | redeclares `base_url` with a default while the base declares it required | pydantic allows it; the port reproduces the observable behaviour |
| P-10 | `inference.py:373` `load_models` | `functools.cache` means an edited `models.json` is never re-read for the life of the process | fine for a CLI. **Not fine for a long-lived page** where the user edits the catalogue in the Bench — that view needs a way to drop the cache |

## Diverged, with the reason

| # | Where | What the Python does | What this does |
|---|---|---|---|
| D-1 | `components.py:158` `History.key()` | hashes a Python tuple with the builtin `hash()`, which is **salted per process** by `PYTHONHASHSEED` — so the key is not stable across restarts, and the docstring's flat-render-cost claim holds only within one run | a deterministic FNV-1a pair over the lines joined by NUL. The separator is NUL and not a space because a space lets `["a b","c"]` and `["a","b c"]` collide, and a colliding memo key serves the **wrong bytes** |
| D-2 | `skills.py:105` `_read_skill` | `[str(t) for t in (metadata.get("tools") or [])]` — a scalar `tools: read_file` is iterated **character by character** into nine bogus tool names, silently | a non-list yields `[]` |
| D-3 | `utils.py:85` `parse_agent_file` | `yaml.safe_load(frontmatter) or {}` swallows frontmatter that is exactly `false`, `0` or `''` into `{}` — the same silent-empty-config failure the guard on the next line exists to prevent | those reach an error |
| D-4 | `agent.py:118` | `Session(messages=self._transcript.messages)` hands pydantic a list, which pydantic v2 validates into a **new** list. The session's messages are a snapshot at construction, not the transcript — the same family as F-4 | a live view, per R3 |
| D-5 | `memory.py:163` `_replace_log` | `with_suffix(suffix + ".tmp")` **replaces** the existing suffix rather than appending. Correct for `log.txt`; wrong for any multi-dot name | the fs port appends `.tmp` |
| D-6 | `space.py:128` `_save` | writes `space.json.tmp` then replaces, but nothing ever cleans a stale temp left by a crash between the two, and `load` does not look for one | the JS deletes its temp on the failure path |
| D-7 | `tools.py:226` `Toolbox.parse_batches` | carries `f"{e.msg} (at character {e.pos})"` into `__arg_error__`, so the model is told **where** its JSON went wrong — the actionable half of that refusal | the engine's own message, with **no offset**. Measured: JavaScriptCore (Bun's engine, and Safari's) puts no position in the `SyntaxError` message and its `line`/`column` are the call site of `JSON.parse` — they read `4:36` for two different failures on two different inputs. V8 does put one in the message, so honouring it would make the string depend on the browser. Deriving an offset would mean a second JSON scanner that has to name the character CPython names, and an offset that disagrees is worse than none |

## The one in the fixtures

**The golden prompts pin a date and a weekday that do not match.** All three
`render-*.prompt` files carry:

```
current time: 2026-08-16 12:00:00 PDT
day: Saturday
```

2026-08-16 is a **Sunday**. `test_core.py:98` hardcoded both strings into
`FIXED_CONTEXT` and replaced `Agent.context` wholesale, so the pair was never
checked against a calendar.

The fixtures are the oracle and they are not editable, so this is a fact the
port has to live with: **a fixed clock cannot derive the golden context block.**
The day has to be pinned the way the Python pinned it, or none of the three
prompts will ever match. `fixedClock` carries a comment saying so, and a test
asserts that `Intl` really does call that date a Sunday — so the next person to
find this reads the reason instead of rediscovering it.

## Still open, for a later increment

- **The fs port is text-only.** `read` returns `string | null`, so an image
  sitting in the workspace cannot be encoded faithfully — a text read mangles
  the bytes. Browser attachments arrive as data URLs and never take that path
  today, but anything that lets a user drop a file into OPFS needs a
  `readBytes` on the port first.
- **P-10, in the page.** The Bench edits `models.json`; the catalogue cache
  never notices.
