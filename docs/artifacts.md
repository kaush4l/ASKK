# Artifacts: design and roadmap

## What an artifact is for

An artifact is **one object that goes through many states** while an agent
works on it: a folder of files, a document, an image, a video. The agent
never sees a log of changes. Every prompt shows the object **as it is now**.

Without artifacts, working on an object fills the conversation with copies.
The agent reads the file, edits it, reads it again, and every version stays
in the history. The context grows with each edit, and old versions compete
with the current one.

With an artifact:

- Edits are **commands** (`fs.edit`, `doc.replace`, `image.crop`, …). A
  command changes the artifact's state and returns one short line ("Edited
  docs/shop.md").
- The next prompt **renders the next state**, in the ARTIFACTS section after
  the conversation history. Only the latest state is ever sent.
- The history stays a record of *what was done*, not *what the object
  looked like*. So context stays small and clean however many edits happen.

Use an artifact when an agent works **on** something across several steps.
Use a plain tool when it asks **for** something once (a search, a fetch, a
calculation) and the answer can stay in history.

## The contract (built)

`backend/core/artifact.js`: one `Artifact` per type per engine.

| Part | Role |
|---|---|
| `state` | Plain, JSON-safe; owned by one engine. Saved to `agents/<engine>/artifacts.json` and restored at startup. Every change goes through `setState()`. |
| `refresh()` | Re-syncs with the source before every LLM step, so a render is never stale. |
| `render()` | The latest state as prompt text. |
| `commands()` | Tools that change the state. Their results stay short, because the content is in the next render. |
| `reset()` | Back to the initial state (called when memory is cleared). |

An agent opts in with `artifacts: [type]` in its `agent.md`. Types are
registered in `backend/features/index.js`.

**State vs. object.** An artifact's `state` is the agent's *view* of the
object: which files are open, which page is in focus, the current selection.
The object itself may be shared (the workspace files are shared by every
agent). Keep the two apart. Per-agent state belongs in `state`; content
belongs in the object's own store.

## Roadmap

### 1. Filesystem: built

`backend/features/filesystem/artifact.js`. It renders the workspace tree (names only,
every level; heavy folders listed but not expanded) and the files this
engine has open, with their current content.

- **Commands:** `fs.open` and `fs.close` change the view; `fs.write`,
  `fs.edit` and `fs.delete` change the files.
- **Per agent:** each engine has its own open list.

Next steps:

- Skip whatever `.gitignore` lists, not just the fixed list of heavy folders.
- Open part of a large file (a line range) instead of the whole file.

### 1b. Skills: built

`backend/features/skills/`. It renders the skill catalogue (name and one line
each, from `public/skills/*/SKILL.md`) and the full text of the skills this
engine has loaded.

- **Commands:** `skills.load` and `skills.unload` change the view.
- **Per agent:** each engine has its own loaded list; skills are shared.

### 2. Document: text with structure

For a long Markdown or text document the agent writes or revises: a report,
a spec, a story.

- **State:** the document, plus the agent's focus (a section or a range).
- **Render:** an outline of all headings, plus the full text of the
  focused sections only, so a long document doesn't flood the context.
- **Commands:** `doc.focus(section)`, `doc.replace(section, text)`,
  `doc.insert(after, text)`, `doc.move`, `doc.delete`.
- **Why an artifact:** each edit would otherwise resend the whole document.
  Here the outline stays small and the agent pulls in only the parts it is
  changing.

### 3. Image: visual state

For generating or editing an image step by step.

- **State:** the current image (stored as a file or blob, not in the
  prompt), its size and format, and the list of operations applied.
- **Render:** text metadata for any model. For a vision-capable model, also
  the image itself as an image part of the prompt.
- **Commands:** `image.crop`, `image.resize`, `image.annotate`,
  `image.generate(prompt)`, `image.edit(prompt, region)`.
- **Prerequisite:** `render()` must be able to return **parts** (text and
  images), not only a string. `models/llm.js` must then send image parts in both
  wire protocols (OpenAI `image_url`, Anthropic `image` blocks).

### 4. Video and other timelines

For a video or audio edit, or a slide deck: an object built from ordered
pieces.

- **State:** the edit decision list (clips, in/out points, order,
  transitions, captions). The media stays in storage.
- **Render:** the timeline as a compact table, plus keyframes or thumbnails
  (as image parts) for the pieces in focus.
- **Commands:** `video.cut`, `video.trim`, `video.move`, `video.caption`,
  `video.export`.
- **Why an artifact:** the media never enters the prompt. The agent edits a
  small structured description and sees only the frames it asks for.

### 5. Anything else with one object and many states

The same pattern fits a spreadsheet (sheet + selected range), a diagram
(nodes and edges), a plan or checklist (items and status), and a form being
filled in.

To check whether something should be an artifact, ask three questions:

1. Does the agent change the same object over several steps?
2. Can its state be rendered compactly, or in a focused part?
3. Does only the latest version matter for the next step?

If all three are yes, it's an artifact.

## Later: history, rollback and undo

Not built yet. The contract is shaped so it can be added without changing
existing artifacts.

- **Versions.** Every change already goes through `setState()` (view
  state) or the object's store (content). Record a version at each change:
  view state as a JSON snapshot, content as a reference to a stored copy
  (for files, the revision hash plus saved bytes).
- **Checkpoints.** Mark a checkpoint at the start of each request. "Undo
  that" then means: restore the artifact to the checkpoint before the last
  request.
- **Commands.** Possibly `artifact.undo()`, `artifact.versions()` and
  `artifact.restore(version)`, also offered to the owner in the UI (a
  history list per artifact).
- **Context stays clean.** Versions live in storage, never in the prompt.
  The render still shows only the current state, perhaps with one line such
  as "version 7 of 7".
- **Shared objects.** Workspace files are shared, so restoring a file
  affects every agent. Rolling back content needs the owner's approval, like
  any other write; rolling back one agent's view state does not.

## Open questions

- Should the same object be able to appear in several agents' artifacts with
  different views? For files this already works. Documents and images need a
  shared store for this.
- Should the owner see artifacts in the chat UI (open files, current image,
  document outline) as well as the agent?
- What should the render budget be per artifact when an agent has several?
  The filesystem artifact caps open files at about 120k characters today.
