# The service and its clients

askk is one program that keeps running (the **service**) and any number of things that come
and go and only ask it (the **clients**: a browser page, the Mac app, a phone, a terminal, a
script). This page says how that works, and what was learnt from two programs that do the
same: VS Code and herdr. `./scripts/service.sh` proves every sentence in section 1.

## 1. What askk does

| you want | you do | what happens |
| --- | --- | --- |
| askk in the background | `askk start` | the same program is started again as a process of its own; the command returns when it answers, and says where. Started twice, it says it already runs, and where |
| to know how it is | `askk status` | running or not, the address, since when, version and build, engines, what it can and cannot do. Ends with 0 only when it runs, so a script can ask |
| to end it | `askk stop` | it is asked to finish (`stop_service`), completes the write in hand, and ends; the command waits for that |
| a new build, or a new address, in force | `askk restart` | stop, then start |
| a terminal on it | `askk terminal` | with a service running for this home, the terminal talks to it; with none, the terminal is the host itself, as before |
| to change how it runs | edit a file in the home | noticed within `look_every_ms` (2 seconds), read again, in force, and every window redraws. No restart |
| the same, now | ask `reload` | looks at once; the answer lists what was read again, what waits for a restart, what was refused and why |
| to see it work | ask `changes`, then `busy` | `changes` is held open until something changes; a run marks a change at every stage it enters |

**How a client finds the service.** While it runs, the service keeps a record,
`service.json`: address, process number, version, build, start time, data place, log. It is
in the folder `service` in the home (with no `ASKK_HOME`: the hidden folder `.service` inside
the data folder), next to `service.log`. The record is removed at stop. One whose process is gone (the machine
was switched off) is noticed and cleaned away by whoever reads it next. Only a process known
to be askk is ever ended from outside.

**How a client knows it is still the same service.** It asks `hello`: version, build,
start time, process number. Held against the hello it had (`ui/features/service.rs`, `seen`):

| seen | because | the client |
| --- | --- | --- |
| same | nothing differs | goes on |
| restarted | a new start time | asks for everything again |
| rebuilt | a new build | loads itself again: it was made for the old program |
| gone | nothing answers | keeps what it shows, says so, tries again |

The build is a short name for exactly the source a program was made from (`build.rs`). The
service and the page it serves are made from the same source, so they carry the same one.

**The settings.** `settings.json` in the data place is the one file about the service
itself. Models, theme, words and layout keep their own files.

| key | means | an edit holds |
| --- | --- | --- |
| `listen` | the address and port it answers at (`127.0.0.1:8090`) | after `askk restart`; `PORT` and `IP` in the environment win over it |
| `origins` | pages at other addresses that may ask, beside `ASKK_ORIGINS` | at once |
| `look_every_ms` | how often the home is looked at for hand edits; 0 = only on `reload` | at once |

**What is read again in place, and what is not.**

| edited by hand | takes effect |
| --- | --- |
| `settings.json` | as the table above says |
| `models.json` | at the next question to a model |
| `theme.json`, `ui.json`, `layout.json`, `surfaces.json`, `senses.json`, `harnesses.json`, `modes.json`, a page, a component | at once: they are read each time they are asked for, and every window is told |
| an engine's `goal.md` (any text an element keeps as a file) | in that engine's next prompt |
| an engine's `engine.json` | name, words, icon at once; model, steps, flow from its next run |
| an engine's `elements/<name>.json` | from its next step; what the element remembers stays |
| **not in place:** `askk.json`, a new or removed engine or element, values from `personal/bindings.json`, `listen`, the environment, the program itself | after `askk restart`, and `reload` says so |

Two rules keep this safe. A file that cannot be read (a typing mistake) is refused in a
sentence and what was in force is kept. And the owner's edit wins: the service does not
write over a file a person changed until it has read it.

## 2. What was learnt

**VS Code** splits itself into a window (the "workbench") and processes behind it; with
remote work, the part behind is the *VS Code Server* on the other machine.

| it does | source | askk |
| --- | --- | --- |
| The server is started by the client or by a command (`code tunnel`, `code serve-web`), not by hand-made start scripts | [remote FAQ](https://code.visualstudio.com/docs/remote/faq), [tunnels](https://code.visualstudio.com/docs/remote/tunnels) | takes it: `askk start` |
| A dropped connection is retried; the server waits three hours for the client before giving up (`--reconnection-grace-time`) | [ipc.net.ts](https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/ipc/common/ipc.net.ts), [serverEnvironmentService.ts](https://github.com/microsoft/vscode/blob/main/src/vs/server/node/serverEnvironmentService.ts) | simpler: the service never waits for anyone and never gives up. A client that was away asks `hello` and starts over if it must |
| "Reload Window" restarts the window; terminals survive it because they live in another process | [terminal docs](https://code.visualstudio.com/docs/terminal/advanced) | takes it: engines live in the service, so any window can be closed, reloaded or replaced |
| Client and server must be the very same build; a client of another build is refused | [remote extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions), [remoteExtensionHostAgentServer.ts](https://github.com/microsoft/vscode/blob/main/src/vs/server/node/remoteExtensionHostAgentServer.ts) | takes the idea, not the refusal: `hello` carries the build, and a page of another build loads itself again |
| Settings apply as they are saved; a setting that cannot says that it needs a restart | [settings](https://code.visualstudio.com/docs/configure/settings), [relauncher](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/relauncher/browser/relauncher.contribution.ts) | takes both halves: read again in place, and say plainly what waits for a restart |

**herdr** ([github.com/herdrdev/herdr](https://github.com/herdrdev/herdr),
[herdr.dev](https://herdr.dev)) is a terminal program, written in Rust, that keeps coding
agents running in panes.

| it does | source | askk |
| --- | --- | --- |
| "a background server plus one or more attached clients"; the server owns the processes, the client is only the screen | [concepts](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/concepts.mdx) | the same split |
| Clients and the command line talk to the server over one local socket, in lines of JSON; changes are pushed to subscribers | [socket API](https://herdr.dev/docs/socket-api/) | one door too (`/ask`, JSON), over HTTP so a browser page is a client like any other; changes are a question held open, not a push |
| `herdr` starts or attaches; detaching leaves everything running; `herdr server stop` ends it | [README](https://github.com/herdrdev/herdr/blob/master/README.md), [session state](https://herdr.dev/docs/session-state/) | `askk start`, `askk terminal`, `askk stop` |
| One config file; `herdr server reload-config` applies most settings while everything keeps running, and says that settings read at startup still need a restart | [configuration](https://herdr.dev/docs/configuration/) | `reload`, with the same honesty. askk also notices the edit by itself |
| Client and server builds need not match: they agree on what each can do | [socket API](https://herdr.dev/docs/socket-api/) | `capabilities` already says what a build can do; the build in `hello` is only used to reload a stale page |
| After a server restart the processes are gone; the layout is restored | [session state](https://herdr.dev/docs/session-state/) | an engine's state is on disk after every step, so a restart loses at most the step in hand |

## 3. What askk does differently, and why

Both facts that steer askk (see [decisions.md](decisions.md)) make it simpler than either.

**One person uses it.**

- No accounts, no tunnel, no login: the service listens on this machine only, and the
  record in the home is how its owner's programs find it.
- One service per home. A second start is not an error to sort out: it says where the first
  one is.
- Config is not split between client and server. One person has one home; the settings are
  the service's, and every window shows the same.

**It runs for as long as the machine does.**

- Nothing shuts it down for being idle, and it keeps no count of clients.
- The owner edits a file and it holds: the service looks for edits itself, so "reload" is
  never something to remember.
- A restart is ordinary. State is written after every step, a run cut off is read back as
  `interrupted`, and clients tell a restart from a rebuild by one question.

**The page does it too.** A page's one listener (`ui/web/views/live.rs`) asks `hello` on
its first answer, each time it comes back from being away, and each time the change feed
starts over. Restarted: every view asks again, the page stays. Rebuilt: the page loads
itself again, once per build of the service, so page and service are always the same build.

**Not there yet.** On Windows the four commands say they are not there. A new engine folder
copied into the home is booted at the next start, not in place. The log is one file that
grows. The page does not yet say in words that the service is away or was restarted.
