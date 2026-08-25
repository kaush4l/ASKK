# The seam — frozen

> `handle(request) -> response` is the only door (I4). This file is the FREEZE
> POINT between the SPINE lane, which produces projections, and the FACE lane,
> which renders them. Neither lane may change a row here without a lead ruling.

## The contract

```js
/**
 * The one entry point. Synchronous by construction: a request either projects
 * what the log already holds, or it RECORDS a fact and returns the projection
 * that fact produced. Work that takes time is never awaited here — it is
 * queued as an effect and the driver runs it, so the interface can never hang
 * on a model call.
 * @param {App} app
 * @param {Request} request
 * @returns {Response}
 */
export function handle(app, request) {}

/** @typedef {{method: string, path: string, headers: Record<string,string>, body: Record<string,string>}} Request */
/** @typedef {{status: number, view: string, data: Record<string, unknown>}} Response */
```

`headers['x-agent']` addresses one agent. Absent means this process's own agent.
It is a header and not a path segment because `/chat` must stay ONE route
however many conversations it projects.

## The routes

| Method | Path | View | What it projects | Records |
|---|---|---|---|---|
| GET | `/` | `dashboard` | every pane's tile, the roster, what is running | — |
| GET | `/tiles` | `tiles` | just the dashboard tiles, for a poll | — |
| GET | `/panels/status` | `status` | the one-line health of the build | — |
| GET | `/chat` | `chat` | one agent's transcript, its phase, what it is waiting on | — |
| POST | `/chat` | `chat` | the transcript with the new message in it | `user_message` |
| POST | `/chat/stop` | `chat` | the transcript, now stopping | `custom:stop_requested` |
| GET | `/chat/halt` | `chat` | the transcript after a hard halt | `agent_status` |
| GET | `/chat/clear` | `chat` | an empty transcript | replaces the log segment |
| GET | `/agents` | `agents` | every agent, its file, its model, what failed to load | — |
| POST | `/agents` | `agents` | the roster after an install | `module_installed` |
| POST | `/agents/file` | `agents` | the roster after a file was written here | `custom:agent_authored` |
| GET | `/agents/delete` | `agents` | the roster without it | `custom:agent_deleted` |
| GET | `/board` | `board` | every agent's status, route, stage walk, lap | — |
| GET | `/tools` | `tools` | every tool, its capability, whether it resolves | — |
| GET | `/space` | `space` | the shared space's contents | — |
| GET | `/files` | `files` | one directory of the workspace | — |
| POST | `/files` | `files` | the directory after a write | — |
| GET | `/terminal` | `terminal` | the command history and what is in flight | — |
| POST | `/terminal` | `terminal` | the history with the command queued | — |
| GET | `/terminal/stop` | `terminal` | the history after an interrupt | — |
| GET | `/processes` | `processes` | what is running, and for how long | — |
| POST | `/processes` | `processes` | the list after a stop | — |
| GET | `/debug` | `debug` | the log, folded into turns, as facts | — |
| GET | `/settings` | `settings` | the endpoint catalogue and what it resolves to | — |
| POST | `/settings` | `settings` | the catalogue after an edit | — |

Anything else is `problem` with status 404 and a sentence naming the address.

## The problem projection

Every failure the seam can return has ONE shape, so the interface has one error
component and cannot miss a case:

```js
{ status, view: 'problem', data: { kind, message, detail, repair } }
```

`message` is one sentence a person can act on. `repair` is what to do about it,
empty when there is nothing to do. `detail` is for the person who opens the
debug view. A failure that returns an empty projection instead of this is a bug.

## What the FACE lane may not do

- Compute a fact. If a view needs a count, a duration, a sort order or a status,
  the core sends it (I5).
- Reach past `handle`. There is no second door and no direct read of `App`.
- Invent a view name. A `view` the table above does not list cannot be produced,
  so a component for it is a component for a state that cannot happen.
