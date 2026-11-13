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
| answers the agent asks for (approvals) | an engine's asks answered in its tile; a tool call its permission mode holds is an approval with Allow and Deny in the conversation (and a yes/no ask in its tile; the box is blocked). A harness's own refusals reach the owner too: what Claude Code's careful mode refused (`permission_denials`) waits in the session as an approval card (Allow / Deny, `HarnessAsks`); Allow resumes it with `--allowedTools` for exactly those calls (`Bash(<command>)`, else the tool), Deny clears them and notes it in the conversation | built | `core::permit` test; seen 2026-11-12: `run(…)` waited, Allow ran it, Deny gave the model "the owner did not allow run". Harness asks: `core::session` and `host::harness::claude` tests (the real 2.x wire); 2026-11-12 the built app with a stand-in `claude` on the PATH, over `/ask`: the denial became one pending ask, Allow re-ran it with `--resume … --allowedTools Bash(touch made-by-claude.txt)`, Deny cleared it with a note. Seen 2026-11-12 in WebKit at 1280 and 390: the card "claude asks to do this: Bash touch made-by-claude.txt" with Allow and Deny under the refusal; Allow went on and the card left; Codex (`exec` never asks), OpenCode (rejects in `run`, no event says so) and Muse bring no asks |
| permission modes | ask every time / allow edits / allow all, chosen in the composer, kept in the engine's `engine.json` (`permit`), held at the toolbox (`core/permit.rs`): files and engines changed are edits, `run`/`spawn`/`stop` run programs, reading and its own notes always go. A session gives its harness the mode in its own words: Claude Code `--permission-mode` (`acceptEdits`, `bypassPermissions`), Codex `-s` (`workspace-write`, `danger-full-access`); Muse takes none. An engine with no mode allows all, as before | built | `core::permit`, harness tests; seen 2026-11-12: "Ask every time" chosen on the page wrote `"permit": "ask"`. The harness flags are checked against the programs' `--help`, not run |
| `@` mentions, `/` commands, `$` skills | a menu opens as `/` (at the start), `@` or `#` is typed, moved with the arrows, taken with Enter or Tab, closed with Escape: `/clear /new /goal /model /compact /permit`; `@` names another box or conversation and the message carries a note on it; `#` names a workspace file; `$` names a skill on disk (`SKILL.md` in the workspace's `.claude/skills` or `.agents/skills`, then the owner's, and `~/.codex/skills`) and the message says where it is, to be read and followed | built | `features::compose` tests; seen 2026-11-12: the `/` menu with ArrowDown to `/goal`, `@as` offered `@askk`. seen 2026-11-12 in WebKit: `$cave` offered `$cavecrew`, `$caveman`, … from `~/.claude/skills`, Enter wrote `$cavecrew `; `host::skills` and `features::compose` tests |
| `/goal` across turns | an engine has a goal by design (`goal.md`); `/goal <text>` sets it from the composer | built | seen 2026-11-12: `/goal Answer in metres` wrote `goal.md` and said so |
| settle, snooze, archive, undo | a conversation is renamed, settled (listed under Settled) or archived (out of the list, still found), with Undo for 5 s, or snoozed for a day (under Snoozed, "back in 24 h", woken early or back on its own); the list searches titles and words | built | `core::talks` test; seen 2026-11-12: archive showed Undo and the list lost the row, Undo brought it back; a search for "metres" found the conversation by its words; seen 2026-11-12 in WebKit: Snooze moved "hello snooze test" under Snoozed, "back in 24 h", Wake brought it back |
| prompt stash, ArrowUp recall, cite a reply, edit from here | mod+S puts the text aside (kept by the browser per engine) and brings it back; ArrowUp in an empty composer walks back through what was asked; "Cite in composer" quotes the words chosen in an answer, or all of it; "Edit from here" forgets the conversation from that message on and puts it back in the composer | built | `features::compose`, `core::owner` tests; seen 2026-11-12: two ArrowUps brought back the prompt before last, mod+S said "1 put aside", a chosen phrase came in as `> Streams arrive piece by`, edit from here emptied the thread and filled the composer |
| voice input | the Web Speech API where the browser has one (a mic button and mod+shift+D, the words written in as heard); hidden where it has none | part | seen 2026-11-12: the button and the key started it; the Browser pane refused the microphone and the composer said so. Speech itself was not heard |
| remote access, phone app | the service listens on this machine only, by decision | no (by decision) | `docs/decisions.md` |
| several providers (Claude Code, Codex, OpenCode…) | harnesses: claude, codex, opencode, muse sessions | part | `host/harness/`: claude, codex and muse checked against the installed programs; opencode (`opencode run --format json`, prompt on stdin, `--session`, `--model provider/model`, `--auto` for `all`) read from its source (`anomalyco/opencode` `packages/cli`) on 2026-11-12 and unit-tested on the event shapes its own tests expect, but not run: it is not installed here |

## herdr

| herdr | askk | state | proof |
| --- | --- | --- | --- |
| a server owns the terminals; clients attach and detach (`ctrl+b q`) | the service holds them; `askk terminal` attaches, `ctrl+b q` leaves them running | built | `scripts/terminals.sh` |
| panes split right or down, zoom, drag borders, mouse | the same | built | `scripts/terminals/tui.py` walk; `target/shots` frames |
| tabs | tabs, restored with their splits after a window closes | built | `terminals.sh` (layout restored) |
| workspaces with git state | panes grouped by place, branch and changed count | built | `workspaces` answer; walk |
| agent states blocked, working, done, idle, unknown; done per client | the same words; done kept per window | built | `ui/features/boxes.rs` tests |
| agent detection from the screen | depth 1: by program name and screen patterns, said to be a guess | built | `terminals.sh` (stand-in agent working, blocked, idle) |
| copy mode, selection, paste | `ctrl+b [`, `v`, `y` (OSC 52), mouse drag, bracketed paste; `w` `b` `e` by words, `/` finds upwards into the scroll-back (`n` `N`), `ctrl+v` a rectangle | built | walk decodes the OSC 52 bytes of a word, a found text and a rectangle; `copy_mode_goes_by_words_and_finds_a_text_up_into_what_scrolled_off`; a real clipboard is not checked; a word is vim's `W` |
| keys from config, read live | `keys` in `settings.json`, read again in seconds | built | walk (prefix changed to `ctrl+a` live) |
| jump to an agent by number | `ctrl+b 1..9` by priority | built | walk |
| several named sessions (`herdr session attach`, `session list`) | `askk terminal --session <name>` (or `terminal.session` in `settings.json`) lays out and keeps a layout of its own, in one home; `--sessions` lists them (`session_layout`, `save_session_layout`, `terminal_sessions`) | built | `terminals.sh`: a session `work` opened, named in the sidebar's head, its tab and split kept apart from the session without a name, listed, and laid out again; `a_named_session_keeps_a_layout_of_its_own`. A session is a layout, not a server: the terminals are the home's |
| right-click menus | on a pane (split, zoom, rename, copy mode, copy what it shows, open in a new tab, close, end its terminal), a tab (new, rename, close), a box in the sidebar (show, open in a new tab, split right with it, copy its name or last line, end), a place's heading; `ctrl+b m`, and `m` in navigate mode; ↑ ↓ Enter, Esc or q, a click | built | `terminals.sh` walk: a pane's menu opened by a right-click, closed by Esc, its line copying the pane (OSC 52); a tab's and a box's menus; `a_right_click_opens_a_menu_on_a_pane_a_tab_a_box_and_keys_or_a_click_work_it`; `target/shots` frames |
| navigate mode | `ctrl+b w` until Esc: ↑ ↓ a box, `[` `]` a place, h j k l a pane, n p and 1-9 a tab, z, m; the foot says NAVIGATE | built | walk (l moved the focus without the prefix, Esc left); `navigate_mode_goes_over_boxes_places_panes_and_tabs_until_esc`; `target/shots` frames |
| rename panes, read a pane's output and send it input from the CLI | `ctrl+b T` and `ctrl+b P` (and the menus) name a tab and a pane, kept in the layout; `askk terminal --read <id>`, `--send <id> <keys>` | built | walk renames both and the next window finds the names; `terminals.sh` reads a terminal and types into it from the command line. A place is not renamed |
| notifications | a box that comes to wait, fail or be done while no pane in view shows it: a sentence in the foot, `◆` on its row until looked at, and the outer terminal told as `terminal.notify` says (`bell`, `osc9`, `osc777`, `off`); per window | built | walk: the stand-in agent opened by another client came to wait, and the bytes BEL and `OSC 9;askk: … waits for you` were written, the row marked; `a_box_that_comes_to_wait_while_it_is_not_shown_is_told_and_marked_until_it_is_looked_at`. Whether a desktop shows it is the outer terminal's choice; no sounds of herdr's own |
| themes | `terminal.theme`: the page's glass, dark or light (`assets/styling/glass.css`, its 16 terminal colours too), or the outer terminal's own; `terminal.colours`: true colour or 256 | built | walk: the accent `38;2;184;174;240` and the ground written, then the light ground `48;2;247;243;236` at once after an edit of `settings.json`; `the_palettes_are_the_pages_glass_dark_and_light` reads the stylesheet. No named themes beyond these, no custom colours |
| a sidebar that does not fit says how to see the rest | `+N more (ctrl+b w, then ↓)`, the key in force | built | `the_sidebar_counts_what_does_not_fit_and_a_click_finds_the_row_it_shows` |

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

## Browsers and widths

Seen 2026-11-12 with Playwright's own engines, headless, against a built service:

| engine | what was seen |
| --- | --- |
| Chromium (the Browser pane, `scripts/shots.sh`) | every screen, phone to desktop, dark and light |
| WebKit (Safari's engine, build 2227) | Home and Talk at 1440 and 390, dark and light: `backdrop-filter` and `linear()` springs supported, 3–5 glass surfaces, no sideways scroll, the `/` menu opens, no page errors; `$` skills and snooze worked. It showed the composer's model picker running off a 390-wide phone (its row reached 502px); fixed in `talk.css`, the row now fits at 320 and 390 |
| Firefox (159, on the Linux runner: `.github/workflows/firefox.yml`, `scripts/firefox/check.mjs`) | the published tab, every screen (Home, Talk, Sessions, Settings) at 1440 and 390, dark and light: 16 of 16 right on 2026-11-13 (`ed44d9f`): `backdrop-filter` and `linear()` supported, 3–5 glass surfaces, no sideways scroll, `/` opens the menu, no page errors. It first found the tab blank in Firefox: it waited for `navigator.storage.persist()`, which Firefox asks the person about; fixed (`74ba6e2`). Firefox 148 and 1497 do not start on this macOS 27 (headless: no framebuffer; with a window: never comes up), so it is seen there, not here |
| Safari itself | not seen: the owner kept the screen to themselves |

## What this says

Both have their spine on par: a background server that owns the work, clients that
attach, detach and refresh in place, live state per box, streaming, threads, a diff,
a palette, panes and copy mode. Both tables were then built row by row (2026-11-12): every
herdr row and every T3 Code row askk can have is built, each with its proof. What is left
is said in each row: on the page, a harness's own permission prompts, speech heard, and
providers beyond claude, codex and muse;
in the terminal, the limits listed in `docs/service.md` ("Where `askk terminal` is not
herdr"). Remote access stays out by decision.
