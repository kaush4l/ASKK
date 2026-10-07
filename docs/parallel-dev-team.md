# A truly parallel developer team — findings and plan (2026-10-06)

What makes a good developer agent, learned from VS Code, GitHub, Claude Code / Anthropic,
opencode, Hermes Agent, Devika and 31 developer blog and paper sources (listed at the end),
checked against what ASKK's own dev desk did (`custom/dev-desk`), and what was built from it.

## What our own desk showed (logs, memory, state)

- BUILD was never parallel: the lead's memory has only sequential quests, never
  `parallel[programmer…, tester…]`. Two programmers could not work at once (one inbox, one
  letter at a time) and nothing kept their files apart.
- Quests were lost five times (GPU hang, restarts). The lead re-sent only when the owner told it
  to, and sat "waiting for reports" on a tester quest that never arrived (tempconv, still open).
- The lead wrote `src/` itself 49 times, against its own charter: a prompt rule, not enforced.
- The checklist let an answer through after two refusals; programmer and tester had no checklist.
- Nothing stopped code removal: `fs.write` could replace a module with a stub, `fs.delete
  recursive` could drop a folder, and `git reset --hard` / `git clean` / `python -c rmtree` ran.
- What worked: spendlens got a real verified PASS (133 tests, README 13/13) when the tester ran.

## Findings — what holds, what does not transfer

**Parallelism pays for reading, not for writing the same thing.** Anthropic's research system
gained 90% from parallel subagents but says most coding tasks have fewer truly parallelizable
parts; Cognition shows parallel writers making contradictory hidden decisions. VS Code and
GitHub isolate every background/coding agent in its own worktree; Cursor found locks make 20
agents as slow as 2–3 and planner/worker beats a flat team; Steinberger runs several agents in one
folder safely because each owns and commits only its files. *Taken:* contract first, disjoint
file lanes per writer, planner (lead) / workers (programmer + helpers) / one verifier (tester).
*Not taken:* worktrees per agent (our sandbox has one workspace; lanes give the same guarantee
for files without merges) and file locks (Cursor: throughput killer).

**Agents declare done before it is done.** Anthropic's long-running harness: Claude marked
features complete until it was given browser automation and a feature list where every item
starts failing; Claude Code docs: the agent stops when the work looks done — make the stop hard
(Stop hooks, a goal check); GitHub's coding agent runs tests/lint/CodeQL before a PR; Devin works
best on tasks with checkable outcomes; Replit's agent claimed tests passed when they had not.
*Taken:* strict checklists (an answer is refused while an item is open; the only exits are
evidence or an honest blocked skip), checklists for programmer and tester too, features.json
flipped only by the tester, regression suite on every VERIFY, stub/TODO grep (Huntley).

**Agents delete tests and code to "pass".** Kent Beck names disabling/deleting tests as a
warning sign; ImpossibleBench shows frontier models cheat often, stronger ones more; GitHub's
Applied Science team saw Copilot updating tests to fit its code; Replit's agent deleted a
production database during a declared freeze. The fixes that work are structural, not prompts:
read-only tests for the implementer, an explicit way to give up, sandbox and approvals, rollback.
*Taken:* `preserve` (a write that drops a def/class/function/test or guts a code file is refused;
code/test deletes refused), lanes (programmer cannot touch tests/acceptance), destructive git and
python one-liners refused in the terminal for every desk, git commit after each clean task, and
the blocked report as the explicit give-up path.

**Quests must stand alone.** VS Code subagents and Hermes children start with zero parent
history; Anthropic: vague delegation causes duplicate work and gaps; Goedecke: give the why.
*Taken:* every quest carries goal + why, files, tasks with done-when, lane, what to hand back.

**Stalls must be detected by inactivity** (Hermes: idle timeout; opencode: doom-loop guard).
*Taken:* the supervisor sends STALLED when a quest's agent sits idle without it.

**Not taken (yet), on purpose:** self-written skills without an approval gate (Hermes — drift);
LSP (opencode admits the cost; ruff/pyright in the terminal give the same diagnostics); mass
fan-out (5–30 agents, ~15× tokens, little gain on a local 27B model); spec-kit's full phase
ceremony (SPEC/PLAN/CONTRACT is the useful core); Agent HQ / mission-control dashboards
(product positioning — /live already shows every call); Devika's fixed persona chain (it split
the prompt, not the checks, and its authors moved to building on Claude Code).

## What was built

| Piece | Where | Effect |
|---|---|---|
| File lanes `writes: [globs, "!exclude"]` | `backend/features/filesystem/guard.js`, fs.write/edit/append/delete | a write outside the agent's lane is refused, saying who to ask instead |
| `preserve: true` | same | dropping a def/class/function/test, gutting a code file (<50% of ≥20 lines), deleting code/test files or bulk folders is refused; the way out is a blocked report |
| `strict: true` | `backend/engines/react-engine.js` | the final answer is refused while any checklist item is open (was: twice, then through) |
| Helper lanes | `backend/runtime/spawner.js`, `features/team/artifact.js` | `agent.spawn {writes, checklist}`: a helper's lane must sit inside the caller's, exclusions carry over, preserve/strict inherited |
| Stall detection | `backend/runtime/supervisor.js`, `core/base-engine.js` | a quest whose agent is idle without it for `stall_minutes` (10) → STALLED letter to the owner: recall and re-send; repeated every 10 min while it lasts |
| Destructive commands | `companion/terminal.js` `refuseDestructive` | git reset --hard / clean / rm / restore / checkout -- . / push --force / branch -D / stash drop / filter-branch / gc …, and `python -c` that deletes or truncates files, refused on every desk |
| Dev desk | `custom/dev-desk/agents/*/agent.md` | lead: lane shared/, CONTRACT step + features.json, parallel BUILD in one response; programmer: lane projects/ minus acceptance, checklist (scope/check/kept/commit/progress), spawns ≤3 helpers on disjoint module lanes; tester: lane tests/acceptance + report + features, checklist (ran/regression/stubs/features/report); all strict + preserve |

The line now: SPEC → PLAN → CONTRACT → SCAFFOLD (git init) → BUILD `parallel[programmer(→ helpers
per module), tester(acceptance from contract)]` → VERIFY (whole suite, stubs, features flipped by
the tester) → FIX ≤4 → SMOKE (lead) → DELIVER. Agents without these fields (trade desk, public
team) behave exactly as before.

Verified: unit tests for lanes, exclusions, lane nesting, preserve, delete refusal, destructive
git/python, stall detection, and the fs tools wired against a fake workspace (all pass); the
three agent.md files validate; the live server loads the dev desk with the new fields.

## Next (not built)

1. Evidence check in code: `checklist.tick` on check items must cite a run in
   `state/terminal.jsonl` with exit 0 since the quest began (today the tester's separate run and
   the strict list carry it).
2. Durable quests: persist open quests and re-deliver after a restart (today: STALLED + re-send).
3. A replay set of past desk requests (tempconv, spendlens) with pass/fail checks, so charter
   edits are scored, not felt (Hamel Husain, Chip Huyen).
4. Compact earlier (40–60% of context, HumanLayer) for the local 27B model.

## Sources

VS Code / GitHub (14): [agent mode](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode),
[custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents),
[subagents](https://code.visualstudio.com/docs/copilot/agents/subagents),
[multi-agent development](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development),
[unified agent experience](https://code.visualstudio.com/blogs/2025/11/03/unified-agent-experience),
[custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions),
[Copilot coding agent](https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/),
[onboarding the coding agent](https://github.blog/ai-and-ml/github-copilot/onboarding-your-ai-peer-programmer-setting-up-github-copilot-coding-agent-for-success/),
[responsible use](https://docs.github.com/en/copilot/responsible-use/copilot-coding-agent),
[agent firewall](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall),
[Agent HQ](https://github.blog/news-insights/product-news/welcome-home-agents/),
[spec-driven development](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/),
[agent-driven development in Copilot Applied Science](https://github.blog/2026-03-31-agent-driven-development-in-copilot-applied-science/),
[Agentic Workflows](https://githubnext.com/projects/agentic-workflows).

Claude Code / Anthropic (7): [building effective agents](https://www.anthropic.com/engineering/building-effective-agents),
[multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system),
[harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents),
[best practices](https://code.claude.com/docs/en/best-practices),
[writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents),
[context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
[subagents](https://code.claude.com/docs/en/sub-agents).
opencode (3): [agents](https://opencode.ai/docs/agents/), [permissions](https://opencode.ai/docs/permissions/), [LSP](https://opencode.ai/docs/lsp/).
Hermes (3): [repo](https://github.com/NousResearch/hermes-agent), [delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation), [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).
Devika (2): [repo](https://github.com/stitionai/devika), [architecture](https://github.com/stitionai/devika/blob/main/ARCHITECTURE.md).

Developer blogs and papers (31): [Cognition, don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents),
[Cognition, Devin annual review](https://cognition.com/blog/devin-annual-performance-review-2025),
[Simon Willison, parallel coding agents](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/),
[Simon Willison, designing agentic loops](https://simonwillison.net/2025/Sep/30/designing-agentic-loops/),
[Kent Beck, augmented coding](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes),
[ImpossibleBench](https://arxiv.org/abs/2510.20270),
[OpenAI, harness engineering](https://openai.com/index/harness-engineering/),
[METR RCT](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/),
[SWE-agent](https://arxiv.org/abs/2405.15793),
[OpenHands](https://arxiv.org/abs/2407.16741),
[Thorsten Ball, how to build an agent](https://ampcode.com/how-to-build-an-agent),
[Amp, agents for the agent](https://ampcode.com/agents-for-the-agent),
[Aider, repo map](https://aider.chat/2023/10/22/repomap.html),
[Aider, edit formats](https://aider.chat/docs/more/edit-formats.html),
[Armin Ronacher, agentic coding](https://lucumr.pocoo.org/2025/6/12/agentic-coding/),
[Böckeler / Fowler, autonomous agents](https://martinfowler.com/articles/exploring-gen-ai/autonomous-agents-codex-example.html),
[Mitchell Hashimoto, AI adoption journey](https://mitchellh.com/writing/my-ai-adoption-journey),
[Cline memory bank](https://docs.cline.bot/prompting/cline-memory-bank),
[Addy Osmani, AI coding workflow](https://addyosmani.com/blog/ai-coding-workflow/),
[Cursor, scaling agents](https://cursor.com/blog/scaling-agents),
[HumanLayer, advanced context engineering](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md),
[HumanLayer, writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md),
[Geoffrey Huntley, Ralph](https://ghuntley.com/ralph/),
[Harper Reed, LLM codegen workflow](https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/),
[Hamel Husain, evals](https://hamel.dev/blog/posts/evals/),
[Chip Huyen, agents](https://huyenchip.com/2025/01/07/agents.html),
[Lilian Weng, LLM agents](https://lilianweng.github.io/posts/2023-06-23-agent/),
[Peter Steinberger, just talk to it](https://steipete.me/posts/just-talk-to-it),
[Sean Goedecke, tell agents the why](https://www.seangoedecke.com/tell-agents-the-why/),
[Replit database deletion (eWeek)](https://www.eweek.com/news/replit-ai-coding-assistant-failure/),
[Replit database deletion (YourStory)](https://yourstory.com/ai-story/replit-ai-deletes-production-database).
