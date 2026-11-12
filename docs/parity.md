# Parity: the page against T3 Code, the terminal against herdr

The owner's bar (2026-11-11): the UI on par with T3 Code, the terminal on par with herdr.
Checked on 2026-11-12 against each one's own docs, row by row. **built** means it is in
`rust` and there is a proof (a test, a script step, or a screen seen); **part** means a
smaller form is built; **no** means it is not built.

Sources: T3 Code [README](https://github.com/pingdotgg/t3code),
[composer](https://github.com/pingdotgg/t3code/blob/main/docs/user/composer.md),
[thread sidebar](https://github.com/pingdotgg/t3code/blob/main/docs/user/thread-sidebar.md);
herdr [concepts](https://herdr.dev/tui/docs/concepts/),
[configuration](https://herdr.dev/tui/docs/configuration/),
[agents](https://herdr.dev/tui/docs/agents/).

## T3 Code

| T3 Code | askk | state | proof |
| --- | --- | --- | --- |
| a server in the background, a web app and a desktop app on it | `askk start`, the page, the Mac window | built | `scripts/service.sh` |
| app and server kept in step on update | `hello` carries the build; a page of another build loads itself again | built | seen 2026-11-12: a swapped build reloaded an open page once (`a9723ca`) |
| answers stream as they are written | `Infer::stream`, `run_partial`, a caret on the reply | built | `scripts/stream.sh` (a real OpenAI-style server, 21 partials seen) |
| threads: several per project, start, switch | several conversations per engine; read another while one works | built | stream C and E screens; `core/talks.rs` tests |
| queued messages, Send now, edit/remove | queue kept across a reload, Send now, take back | built | stream C screens; `ui/features/queue.rs` tests |
| steer into the running turn | Send now reaches the engine at its next step, not mid-reply | part | — |
| diff of what the agent changed | Diff tab: files written by tools and by programs, kept across a restart | built | `scripts/stream.sh` step 2 |
| files of the project | Files tab, read only | built | stream C screens |
| command palette (`mod+K`), keyboard shortcuts | palette over boxes, pages, actions; `?` lists keys | built | stream B; `ui/features/keys.rs`, `palette.rs` tests |
| pin, find, group by project | pin, find and group by place in the pill | built | stream B screens |
| attachments (images, files, large paste) | attachments sensed by programs on the machine | part | no large-paste-to-file, no drag of many files |
| model picker | default model only; one engine's model cannot be changed from the page | part | — |
| Markdown, code colouring | Markdown, six languages, copy button | built | `ui/features/markdown.rs`, `code.rs` tests |
| answers the agent asks for (approvals) | an engine's asks answered in its tile | part | a harness's own permission prompts are not seen |
| permission modes | — | no | — |
| `@` mentions, `/` commands, `$` skills | — | no | — |
| `/goal` across turns | an engine has a goal by design (`goal.md`) | part | not set from the composer |
| settle, snooze, archive, undo | — | no | — |
| prompt stash, ArrowUp recall, cite a reply, edit from here | — | no | — |
| voice input | — | no | — |
| remote access, phone app | the service listens on this machine only, by decision | no (by decision) | `docs/decisions.md` |
| several providers (Claude Code, Codex, OpenCode…) | harnesses: claude, codex, muse sessions | part | `host/harness/` |

## herdr

| herdr | askk | state | proof |
| --- | --- | --- | --- |
| a server owns the terminals; clients attach and detach (`ctrl+b q`) | the service holds them; `askk terminal` attaches, `ctrl+b q` leaves them running | built | `scripts/terminals.sh` |
| panes split right or down, zoom, drag borders, mouse | the same | built | `scripts/terminals/tui.py` walk; `target/shots` frames |
| tabs | tabs, restored with their splits after a window closes | built | `terminals.sh` (layout restored) |
| workspaces with git state | panes grouped by place, branch and changed count | built | `workspaces` answer; walk |
| agent states blocked, working, done, idle, unknown; done per client | the same words; done kept per window | built | `ui/features/boxes.rs` tests |
| agent detection from the screen | depth 1: by program name and screen patterns, said to be a guess | built | `terminals.sh` (stand-in agent working, blocked, idle) |
| copy mode, selection, paste | `ctrl+b [`, `v`, `y` (OSC 52), mouse drag, bracketed paste | built | walk decodes the OSC 52 bytes; a real clipboard is not checked |
| keys from config, read live | `keys` in `settings.json`, read again in seconds | built | walk (prefix changed to `ctrl+a` live) |
| jump to an agent by number | `ctrl+b 1..9` by priority | built | walk |
| several named sessions (`herdr session attach`) | one service per home; another home is another session | part | — |
| right-click menus | — | no | — |
| navigate mode | — | no | — |
| rename panes, read a pane's output and send it input from the CLI | `terminal_screen` / `terminal_type` over `/ask` | part | no rename |
| notifications | — | no | — |
| themes | the page has themes; the terminal does not | part | — |

## The glass and its motion

From the Apple design skill (springs that do not overshoot, a bounce only where a flick
carries momentum, materials that blur what is behind them), in `assets/styling/glass.css`.
Read off the running page on 2026-11-12:

| what | measured |
| --- | --- |
| the pill and bars | `backdrop-filter: blur(40px) saturate(1.8)`, a 4% fill, an inset highlight, radius 20px |
| a box opening | `scale` over 440ms on `--ease-spring` (a `linear()` curve, damping 1.0); its contents enter on the same spring |
| the canvas leaving under it | opacity 150ms and scale 200ms on `--ease-exit` |
| a press | `transform: scale(var(--press-scale))` in 100ms |
| reduced motion, reduced transparency | springs fall back to 200ms ease, travel to none; glass to a solid fill (seen by stream B) |

## What this says

Both have their spine on par: a background server that owns the work, clients that
attach, detach and refresh in place, live state per box, streaming, threads, a diff,
a palette, panes and copy mode. Neither is whole: the **no** rows above are the next
work, smallest first: permission modes and `/` commands on the page; right-click menus,
navigate mode and notifications in the terminal.
