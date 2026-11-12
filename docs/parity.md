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
| steer into the running turn | **Steer** on a waiting message puts it in the input of the run's very next step (`core/steer.rs`); the composer says "waits for the next step", then "landed at step N"; one that comes after the last step goes to the message box and says so. Not mid-reply: a model asked whole cannot hear before its next step | built | `core::steer` tests; seen 2026-11-12 on a scratch home: a two-step run, "Use metres." steered during step 1, shown "landed at step 2", and the model's answer took it in |
| diff of what the agent changed | Diff tab: files written by tools and by programs, kept across a restart | built | `scripts/stream.sh` step 2 |
| files of the project | Files tab, read only | built | stream C screens |
| command palette (`mod+K`), keyboard shortcuts | palette over boxes, pages, actions; `?` lists keys | built | stream B; `ui/features/keys.rs`, `palette.rs` tests |
| pin, find, group by project | pin, find and group by place in the pill | built | stream B screens |
| attachments (images, files, large paste) | several files by the clip, a drop or a paste; a paste of 32 KB or more becomes `pasted text.txt` (mod+shift+V keeps it as text); the limits are stated on the clip (400 MB a file, a text read up to 20,000 characters) | built | seen 2026-11-12: a 43 KB paste became a ready text chip, mod+shift+V left a 40 KB paste as text, a drop of two files made two chips (paste and drop sent as synthetic events, not by hand); the tab has no sensing, so it says an attachment needs a machine |
| model picker | the composer names this engine's own model (`set_engine_model` writes its `engine.json`), or "Default (…)" to follow the default; `/model <name>` does the same | built | `core::owner` test; seen 2026-11-12: `askk/developer` set to `sse-two` from the page, its `engine.json` said so, `askk` and the default stayed, and its next run asked `sse-two` |
| Markdown, code colouring | Markdown, six languages, copy button | built | `ui/features/markdown.rs`, `code.rs` tests |
| answers the agent asks for (approvals) | an engine's asks answered in its tile; a tool call its permission mode holds is an approval with Allow and Deny in the conversation (and a yes/no ask in its tile; the box is blocked) | part | `core::permit` test; seen 2026-11-12: `run(…)` waited, Allow ran it, Deny gave the model "the owner did not allow run". A harness's own permission prompts are still not seen |
| permission modes | ask every time / allow edits / allow all, chosen in the composer, kept in the engine's `engine.json` (`permit`), held at the toolbox (`core/permit.rs`): files and engines changed are edits, `run`/`spawn`/`stop` run programs, reading and its own notes always go. A session gives its harness the mode in its own words: Claude Code `--permission-mode` (`acceptEdits`, `bypassPermissions`), Codex `-s` (`workspace-write`, `danger-full-access`); Muse takes none. An engine with no mode allows all, as before | built | `core::permit`, harness tests; seen 2026-11-12: "Ask every time" chosen on the page wrote `"permit": "ask"`. The harness flags are checked against the programs' `--help`, not run |
| `@` mentions, `/` commands, `$` skills | a menu opens as `/` (at the start), `@` or `#` is typed, moved with the arrows, taken with Enter or Tab, closed with Escape: `/clear /new /goal /model /compact /permit`; `@` names another box or conversation and the message carries a note on it; `#` names a workspace file | part | `features::compose` tests; seen 2026-11-12: the `/` menu with ArrowDown to `/goal`, `@as` offered `@askk`. No `$` skills: askk has none to name |
| `/goal` across turns | an engine has a goal by design (`goal.md`); `/goal <text>` sets it from the composer | built | seen 2026-11-12: `/goal Answer in metres` wrote `goal.md` and said so |
| settle, snooze, archive, undo | a conversation is renamed, settled (listed under Settled) or archived (out of the list, still found), with Undo for 5 s; the list searches titles and words | part | `core::talks` test; seen 2026-11-12: archive showed Undo and the list lost the row, Undo brought it back; a search for "metres" found the conversation by its words. No snooze |
| prompt stash, ArrowUp recall, cite a reply, edit from here | mod+S puts the text aside (kept by the browser per engine) and brings it back; ArrowUp in an empty composer walks back through what was asked; "Cite in composer" quotes the words chosen in an answer, or all of it; "Edit from here" forgets the conversation from that message on and puts it back in the composer | built | `features::compose`, `core::owner` tests; seen 2026-11-12: two ArrowUps brought back the prompt before last, mod+S said "1 put aside", a chosen phrase came in as `> Streams arrive piece by`, edit from here emptied the thread and filled the composer |
| voice input | the Web Speech API where the browser has one (a mic button and mod+shift+D, the words written in as heard); hidden where it has none | part | seen 2026-11-12: the button and the key started it; the Browser pane refused the microphone and the composer said so. Speech itself was not heard |
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
work, smallest first: snooze, `$` skills and a harness's own permission prompts on the page;
right-click menus, navigate mode and notifications in the terminal.
