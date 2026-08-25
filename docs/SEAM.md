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
| GET | `/agents/delete` | `agents` | the roster without it | `module_removed` |
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

## A route is a PANE; a destination is a SCREEN

The table above lists twenty-five seam routes across eleven panes. The interface
does **not** have eleven destinations, and it never did: the last design round
folded them into four screens that COMPOSE panes — Work, Agents, Setup, and the
design system. A pane is a projection the core can produce; a destination is a
place a person goes. Keeping the two words apart is what stops "add a pane" from
meaning "add a tab", which is how the predecessor grew seven destinations and
then had to spend a round deleting three of them.

## Where the interface lives, in the address bar

The predecessor put every view in the location HASH, because a Wasm bundle
served from one URL had no other option. A static export does have another
option, and it is better: **one real directory per view**, so a reload serves
the page it is on, a link is a link, and browser Back works without a listener.

| Destination | URL | Composes |
|---|---|---|
| Work | `/` | chat, board, files, terminal, trace, processes, space, debug |
| Agents | `/agents/` | agents, tools |
| Setup | `/setup/` | settings, status |
| Design system | `/design-system/` | every component, every state |

**Which agent** a view is about rides in the query string — `?agent=scout` —
and NOT in the path. A path segment would need `generateStaticParams`, and the
set of agents is not known at build time: a person may author one in the
browser. A query string is read on the client, needs no route to exist, and
survives a reload. Absent means the entry agent.

`trailingSlash: true` is set for exactly this reason: GitHub Pages has no
rewrite rules, so every route must be a real directory with an `index.html` in
it or a reload 404s.

## The one thing that does NOT go through the seam, and why

**Saving a credential.** `handle` records a `request_handled` fact for every
request, and the request's body rides into the projection the interface then
renders. A key must never be in either. So the credential broker has its own
door in `adapters-web`:

```js
/**
 * @param {string} entry     which catalogue entry — never the URL
 * @param {{baseUrl?: string, model?: string, apiKey?: string}} patch
 * @returns {Promise<void>}
 */
export async function saveEndpoint(entry, patch) {}
```

`GET /settings` still projects the catalogue through the seam, and it projects
**whether** a key is set, never the key. `POST /settings` carries every setting
EXCEPT the key. This is the only exception to I4 in the tree, it exists because
of I6, and it is written down here so it stays the only one.
