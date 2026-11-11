# 008 OpenBot: what it is, and the gaps it shows in askk's session layer

Source: `github.com/CopilotKit/OpenBot`, shallow clone of 2026-11-10, read as source (README,
`docs/architecture.md`, `docs/approvals.md`, `docs/routines.md`, `toolkit/src/*`,
`agent-claude-sdk/src/*`). REA was not run against it: it is a complete source repository, and
REA's own rule is to use ordinary reading for that. No runtime evidence was taken.
Read against `000`–`007`; `007` is the design this compares to.

## 1. What OpenBot is

| part | what it does | askk's nearest thing |
| --- | --- | --- |
| `app` (React), desktop, mobile, Slack/Teams | many faces over one workspace | `src/ui`, `src/shells` |
| `server` (Hono + Postgres) | API, policy gateway, approvals, audit, routines, coworkers, channels | `src/api`, `core/board.rs`, Asks page |
| `agent-*` (16 folders) | one adapter per agent framework, all speaking **AG-UI** | `host/harness/<kind>.rs` (planned, `004`) |
| `toolkit` | shared turn machinery: thread lock + lease, approval continuation, history sanitize, initiator | `core/session.rs` Harness port (planned) |
| `agent-computer` + `supervisor` | one container per person/Bot: Chromium, `/workspace`, egress filter | `sandbox/server.sb`, `scripts/sandboxed.sh` |
| CopilotKit Intelligence (licensed) | durable threads, memory, automatic learning | the harness's own transcript |

**The shape it shouts:** one wire (AG-UI) between workspace and every agent; **every acting tool
call returns to the server** before it touches anything; the server decides, writes an audit row,
then acts. Agents never hold policy.

## 2. Where OpenBot agrees with what is already decided

- **One seam per harness.** 16 `agent-*` adapters behind one protocol = the `Harness` port.
- **The conversation is someone else's.** Threads live in Intelligence, not OpenBot's database
  = `007`: "the conversation itself is the harness's".
- **A permission ask always reaches a person, fixed in code.** `approvals/policy.ts` puts
  "kinds of action" (delete, send, share, post, pay, credentials) above every rule = `007` step 8.
- **Unattended work is first-class.** Routines and goals fire with nobody there = the desk wakes
  (`scripts/desk-wake.sh`).

## 3. The gaps, and a way to close each

Ordered by how much each costs later if left.

### G1. No record of what *started* a turn

OpenBot: every turn and audit row carries `initiator = person | deployment | routine |
responsibility | memory | handoff{origin}` (`toolkit/src/initiator.ts`), signed so a Bot cannot
relabel itself. "Nobody watching" is one filter.
askk: an envelope has `from` (whose authority), not what caused it. A desk wake and you typing
both read `from: user`.
**Close it:** add `cause` to the envelope: `{"kind": "person" | "wake" | "handoff", "id": …}`, set
in code where it is posted (wake script, session adapter), never by a model. Stage 0, since the
envelope shape freezes there.

### G2. Approvals have one answer; OpenBot has four, with scope

OpenBot: Allow once / Allow for this conversation / Always allow here / Deny. A conversation
allow matches same bot, tool, place and account; a typed rule never opens a protected kind;
strictest matching rule wins.
askk: `answer` settles one `ask`; every permission ask comes back forever.
**Close it:** an `answer` carries `scope: once | thread | always`. `thread` is stored on the
thread root (the `about` chain); `always` writes a rule into the data folder. Keep a hard list
of kinds no rule opens — order placement first, matching `sandbox/rails.json` and
`scripts/order-gate.sh`. Stage 2.

### G3. No audit trail apart from the board

OpenBot: audit row *before* acting, a second if the forwarded action fails; CSV export; secrets
logged as "supplied, N chars".
askk: what happens inside a session is deliberately not an envelope (`007` §1), so nothing
records "the harness ran `npm run build` because you allowed it".
**Close it:** append-only `audit.jsonl`, one line per ask, answer and acted tool call
(`ts, member, cause, tool, decision, rule`), written by the session adapter only. Nothing reads
it to decide, so it is not a second board. Stage 1.

### G4. Interrupted tool calls poison the next turn

OpenBot hit this twice in production: an assistant message whose tool call never got a result
makes every later turn fail ("Tool result is missing for tool call …"). `history-sanitize.ts`
closes such calls before replay.
askk: `lost` → resume by native id (`007` §3) — a host restart mid-tool is exactly this case.
**Close it:** on resume, if the last item is an unanswered tool call, send an "interrupted"
result before the new words (OpenBot's Claude adapter does this, `adapter.py` ~L889). Test:
`a_lost_session_with_an_open_tool_call_resumes_cleanly`. Stage 1.

### G5. One writer per session is stated, not enforced

OpenBot: a thread lock with a lease, renewed while the run works, dropped when renewals fail
longer than the lease lives (`toolkit/src/lease.ts`); a second run is told to retry.
askk: `007` says "one writer per object"; you and askk posting at once can both start a turn.
**Close it:** a per-member lock in the host (an in-process mutex; one host). An envelope arriving
while `working` stays `new` and is taken next turn. Also answers Yours 5: reuse a session only
when its lock is free. Test: `two_envelopes_at_once_make_one_turn`. Stage 0.

### G6. A paused ask dies with its process

OpenBot: `ApprovalContinuation` keeps run id, tool call id, args, messages and state, so an
approval resumes the exact tool call later, on another process.
askk: an ask whose process is gone becomes `gone`; the work is lost.
**Close it:** keep `gone` as the honest default, but store `{native_session_id, tool_call_id}`
on the ask. On answer, if the harness `Can` resume by id, resume and replay the answer; else stay
`gone` and say why. Stage 3+.

### G7. The Claude permission wire — `000`'s open unknown — has a proven answer

`000` lists the stream-json permission value as unknown. OpenBot avoids it: Claude Agent SDK, a
`PreToolUse` hook returning `permissionDecision: allow | deny`, `permission_mode = "dontAsk"`,
and only server-supplied tools allowed (`adapter.py` ~L452–605).
**Close it:** choose before writing the Stage 1 adapter:
1. stream-json + `--permission-prompt-tool` (an MCP tool askk serves) — Rust-only, CLI-native;
2. a `PreToolUse` hook command that posts to the host and blocks for the answer — what OpenBot
   runs in production.
Option 2 is lower risk. Capture one real exchange either way, as `006` asks.

### G8. No network or filesystem wall per session

OpenBot: per-Bot container, its own HMAC-derived token, egress proxy (`allow_all | allowlist |
deny_all`), database on a separate network.
askk: one seatbelt profile for the host (`sandbox/server.sb`); every harness inherits it.
**Close it (cheap):** a session's config names a `wall` (a profile under `sandbox/`), and the
harness starts through `scripts/sandboxed.sh <profile>`. Default: its `projects/<x>` writable.
No containers. Stage 6, or sooner if a desk gets a harness session.

### G9. Learning from finished work

OpenBot: finished conversations → proposed `SKILL.md` → a person approves → later runs load it.
askk: `td-retro` / `refine-desk` do this by hand, desk only.
**Close it:** when a thread settles, askk may post one `ask` to you proposing a note line;
accepting it writes the note. No new machinery. After stage 5.

### Not a gap — leave it

- **AG-UI as the wire.** It fits frameworks you host; your harnesses are CLIs with their own
  wires. Add an `ag-ui` harness kind only to drive an OpenBot-style agent.
- **Postgres, Kubernetes, roles, tenants, Slack/Teams.** Many-people machinery; `000` rejected
  dsh's version for the same reason.

## 4. What changes in the stages (`005`)

| stage | add |
| --- | --- |
| 0 contract | envelope `cause` (G1); per-member lock + test (G5) |
| 1 Claude | pick the permission wire (G7); `audit.jsonl` (G3); open-tool-call repair (G4) |
| 2 engine drives | answer `scope` + protected kinds (G2) |
| 3–4 harnesses | resumable asks where `Can` allows (G6) |
| 6 packs | per-session `wall` (G8) |
| after 5 | learning as an ask (G9) |

## 5. Unknowns

- Whether a `PreToolUse` hook may block for minutes while a person answers. Check the installed
  CLI's hook timeout before choosing G7 option 2.
- OpenBot's notes say upstream `ag-ui-claude-sdk` loses history on restart; not verified here.
- Nothing in this file was run.
