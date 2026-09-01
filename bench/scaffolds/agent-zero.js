/**
 * agent-zero's REAL scaffold.
 *
 * Source: https://github.com/frdel/agent-zero at commit 6a6cecf ("Refresh
 * context usage during generation"), MIT. Nothing below is written from an
 * impression of agent-zero. The prompt text is READ AT LOAD TIME from the
 * seventeen PROMPT files vendored into `bench/vendor/agent-zero/` — byte for
 * byte, at their upstream paths, hashed in `bench/vendor/agent-zero/PROVENANCE.md`
 * beside two python files nothing reads, which are the oracle for the parser
 * divergence in CUTS — and
 * assembled by reimplementing the exact python that assembles it. It used to
 * read a clone in a sibling directory, which meant every number this arm ever
 * produced depended on a checkout on one machine; that is the thing
 * `CAPABILITIES.md` refuses to call evidence. Every departure from what
 * upstream would send is listed in CUTS below, applied through `cut()` so a
 * departure that stops applying is a failing test rather than a silence, and
 * stamped into the transcript.
 *
 * ── what agent-zero does, and where each piece comes from ────────────────
 *
 * SYSTEM PROMPT  = "\n\n".join(system_prompt) then remove_code_fences(json)
 *   agent-zero/agent.py:583  `files.remove_code_fences("\n\n".join(loop_data.system), language="json")`
 *   The list is filled by the system_prompt extensions in numeric order:
 *     _10_main_prompt.py  -> prompts/agent.system.main.md
 *         agent-zero/extensions/python/system_prompt/_10_main_prompt.py:22
 *     _11_tools_prompt.py -> prompts/agent.system.tools.md with {{tools}} =
 *         "\n\n".join of every agent.system.tool.*.md found across the prompt dirs
 *         agent-zero/extensions/python/system_prompt/_11_tools_prompt.py:30-52
 *   (_12_mcp, _13_secrets, _13_skills, _14_project contribute nothing with no
 *   MCP server, no secrets, no skills and no project — the state this rig runs in.)
 *
 * MESSAGES  = SystemMessage(system_text) + history + [EXTRAS]
 *   agent-zero/agent.py:604-609
 *   history entries, all of them plain user/assistant chat messages:
 *     user task      dict from prompts/fw.user_message.md, empty keys dropped
 *                    agent-zero/agent.py:739-763  ->  {"user_message":"..."}
 *     assistant      the raw reply text; prompts/fw.ai_response.md is `{{message}}`
 *                    agent-zero/agent.py:767-777
 *     tool result    dict {"tool_name":..., "tool_result":...} added as a USER
 *                    message — agent-zero/agent.py:785-807 with ai=False
 *     warning        dict from prompts/fw.warning.md -> {"system_warning":"..."}
 *                    agent-zero/agent.py:780-782
 *   A dict content is serialised compactly, separators (",",":"):
 *     agent-zero/helpers/history.py:679-688 and :810-811
 *   Adjacent same-role messages are merged with "\n":
 *     agent-zero/helpers/history.py:704-713 and :758-760
 *   [EXTRAS] is appended after the history on EVERY call and is not stored:
 *     agent-zero/agent.py:594-605, prompts/agent.context.extras.md
 *     contents come from extensions/python/message_loop_prompts_after/
 *       _60_include_current_datetime.py  -> prompts/agent.system.datetime.md
 *       _70_include_agent_info.py        -> prompts/agent.extras.agent_info.md
 *       _75_include_workdir_extras.py    -> prompts/agent.extras.workdir_structure.md
 *         (kept: helpers/settings.py:575 defaults workdir_show to True)
 *
 * TOOL CALL CONTRACT  = one JSON object, the WHOLE reply, no fences.
 *   The parser refuses anything that does not start with `{` and end with `}`:
 *     agent-zero/helpers/extract_tools.py:23-36  extract_tool_request
 *   and the request must normalise to a tool_name string plus a tool_args dict:
 *     agent-zero/helpers/extract_tools.py:79-128 normalize_tool_request
 *     including the `tool:` / `args:` aliases, the `{"actions":[{...}]}` wrapper,
 *     the `type:"function"` shape, `"tool_name": "x:action"` splitting into
 *     tool_args.action, and `method` promoting to `action`.
 *   A reply that is not a tool request gets prompts/fw.msg_misformat.md as a
 *   system_warning:  agent-zero/agent.py:1519-1521
 *   An unknown tool name gets a plain-text warning:  agent-zero/agent.py:1510-1517
 *   A reply identical to the previous one gets prompts/fw.msg_repeat.md:
 *     agent-zero/extensions/python/message_loop_result/_30_repeat_response.py:29
 *   Five consecutive unusable replies stop the run:
 *     agent-zero/extensions/python/_functions/agent/Agent/hist_add_warning/end/
 *       _90_stop_unusable_response_loop.py, limit from settings.py.dox.md:72 (5)
 *
 * REASONING: the endpoint puts several hundred tokens of working in
 * `reasoning_content`, and the driver never feeds that into the parser — which
 * matches agent-zero, whose parser reads `llm_result.response` and only falls
 * back to reasoning when the response is EMPTY (agent.py:1124-1130).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** The vendored copy, inside the repository. Never a clone outside it. */
export const AZ_ROOT = resolve(HERE, '..', 'vendor', 'agent-zero')

// ── reading agent-zero's prompt files ──────────────────────────────────────

/**
 * The prompt search path.
 *
 * agent-zero collects prompt dirs through helpers/subagents.get_paths(agent,
 * "prompts"), which walks the agent profile and every enabled plugin. With the
 * stock profile and the two plugins whose tools we keep, that is these three.
 */
const PROMPT_DIRS = [
  join(AZ_ROOT, 'prompts'),
  join(AZ_ROOT, 'plugins', '_code_execution', 'prompts'),
  join(AZ_ROOT, 'plugins', '_text_editor', 'prompts'),
]

function findPrompt(name) {
  for (const dir of PROMPT_DIRS) {
    const path = join(dir, name)
    if (existsSync(path)) return path
  }
  return null
}

/** agent-zero/helpers/files.py:436-442 — remove_code_fences(text, language). */
function removeJsonFences(text) {
  return text.replace(
    /^[ \t]*(```|~~~)[ \t]*json[ \t]*\r?\n([\s\S]*?)^[ \t]*\1[ \t]*\r?$/gim,
    (_all, _fence, body) => body,
  )
}

/**
 * `{{ include "x.md" }}` and `{{var}}`, which is all agent-zero's prompt
 * templating uses in the files this scaffold reads.
 */
function readPrompt(name, vars = {}) {
  const path = findPrompt(name)
  if (!path) throw new Error(`agent-zero prompt not found: ${name} (looked in ${AZ_ROOT})`)
  let text = readFileSync(path, 'utf8')
  text = text.replace(/\{\{\s*include\s+"([^"]+)"\s*\}\}/g, (_all, included) =>
    readPrompt(included, vars),
  )
  // `{{if x}}...{{endif}}` — the one conditional in agent.extras.agent_info.md.
  text = text.replace(/\{\{if\s+(\w+)\}\}([\s\S]*?)\{\{endif\}\}/g, (_all, key, body) =>
    vars[key] ? body : '',
  )
  text = text.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in vars ? String(vars[key]) : all))
  return text
}

// ── the cuts ───────────────────────────────────────────────────────────────

/**
 * Every departure from what the clone would send, and why.
 *
 * These are a thumb on the scale and a critic must be able to audit them, so
 * each one names the file it edits, what it removes, and the capability our
 * four tools do not provide that forces the removal. The rule applied
 * throughout: a prompt that promises a capability we cannot supply is worse
 * than a prompt that never mentioned it — the agent spends turns reaching for
 * something that is not there — so the promise goes with the tool.
 *
 * Nothing here makes agent-zero's scaffold weaker at the tasks in tasks.js.
 * Every cut removes a tool it would not have been able to call anyway, or
 * replaces a false statement about the environment with a true one.
 */
export const CUTS = Object.freeze([
  {
    where: 'the tool list (agent.system.tools.md {{tools}})',
    cut: 'every agent.system.tool.*.md except response, code_exe and text_editor',
    dropped: [
      'call_subordinate',
      'a2a_chat',
      'notify_user',
      'parallel',
      'scheduler',
      'search_engine',
      'skills',
      'wait',
      'input',
      'memory',
      'behaviour',
      'browser',
      'document_query',
      'office_artifact',
      'goal',
      'vision_load',
      'code_execution_remote',
      'text_editor_remote',
      'computer_use_remote',
    ],
    why: 'this rig provides four capabilities — read a file, write a file, list a directory, run a shell command. Every tool above needs something else: a network, a second agent process, a vision model, a scheduler, a persistent session, a browser. Leaving them listed would have agent-zero spend its twelve turns calling tools that cannot exist.',
  },
  {
    where: 'prompts/agent.system.main.environment.md',
    cut: 'the whole file, replaced with a true description of this rig',
    why: 'the shipped text says the agent lives in a kali linux docker container with /a0 and /opt/venv. Here it is a bun process on macOS in a temp directory. Leaving a false environment in would not be faithfulness, it would be sabotage: agent-zero would probe for paths that are not there. The replacement states the same KIND of fact (where you are, what runtimes exist) about the real place.',
  },
  {
    where: 'prompts/agent.system.main.solving.md',
    cut: 'the memory/skills line in step 1, the subordinate lines in step 3, the memorize lines in step 4, and the "if tool patch fails" line in the coding checklist',
    why: "no memory tool, no skills tool, no call_subordinate, and text_editor's patch action is cut below. Each cut line names one of them.",
  },
  {
    where: 'prompts/agent.system.main.tips.md',
    cut: 'the "memory refers memory tools" line, the whole "## Skills" section, the "always use specialized subordinate agents" line, and the whole "## Documents and OCR" section',
    why: 'memory, skills, subordinates, document_query and vision_load are all cut tools.',
  },
  {
    where: 'prompts/agent.system.main.communication.md',
    cut: 'the line directing independent concurrent operations to the `parallel` tool',
    why: 'the parallel tool is cut. The neighbouring line about doing dependent operations one at a time is KEPT — it costs agent-zero nothing and is true here.',
  },
  {
    where: 'prompts/agent.system.main.communication_additions.md',
    cut: 'the `parallel`-tool line and the whole "## replacements" section (§§name(params), §§include)',
    why: 'no parallel tool, and the §§ replacement machinery is framework code that does not exist in this rig. A promise to reuse file contents by reference that silently does nothing would corrupt whatever the agent writes with it.',
  },
  {
    where: 'prompts/agent.system.tools.md',
    cut: 'the sentence naming `parallel` as the wrapper for concurrent calls',
    why: 'the parallel tool is cut. The rest of the paragraph — do not invent tool names, action names are not tool names — is kept verbatim and is the part that matters.',
  },
  {
    where: 'plugins/_code_execution/prompts/agent.system.tool.code_exe.md',
    cut: 'runtime=output, the session and reset args, the `input` tool line, and every rule and example about polling, long-running jobs and stuck sessions',
    why: '`run` in tools.js is synchronous with a 30s timeout and no session state — the same implementation our scaffold gets. runtime terminal, python and nodejs are KEPT and all three work (node v22, python3 3.14 are on this host).',
  },
  {
    where: 'plugins/_text_editor/prompts/agent.system.tool.text_editor.md',
    cut: 'the whole `patch` action, the line_from/line_to args of `read`, open_in_canvas, and the office_artifact cross-reference',
    why: 'write_file in tools.js overwrites whole files and read_file returns whole files — there is no patch and no line range. The `read` and `write` actions are kept with their real arg names.',
  },
  {
    where: 'prompts/agent.system.tool.response.md',
    cut: 'the include of agent.system.response_tool_tips.md',
    why: 'that file is one line and its only content is "use §§include(path) instead of rewriting", which is the cut replacement machinery.',
  },
  {
    where: 'helpers/extract_tools.py — the interior parse',
    cut: "the LENIENCY of upstream's parser: `extractToolRequest` here is `JSON.parse`, where upstream's `extract_tool_request` goes through `_parse_json_root_object` -> `DirtyJson.parse_string`",
    dropped: ['trailing commas', 'single-quoted strings', 'unquoted keys'],
    why: 'this is the only cut that makes the REFERENCE arm worse, and it lands on the quantity the rig measures. Three shapes upstream accepts as a tool call are scored `misformat` here, so every misformat count, turn count and token count this arm produces is inflated by an unmeasured amount, in one direction. The OUTER strictness is not a cut and is faithful — a reply that is not a single complete JSON object and nothing else is a misformat upstream too, verified for prose-before, a ```json fence and an unterminated object. Re-derivable from this repository against `vendor/agent-zero/helpers/extract_tools.py`; the command is in PROVENANCE.md and the seven measured shapes are pinned in `test/bench/agentZeroScaffold.test.js`. No misformat rate may be quoted from this rig without citing this row.',
  },
  {
    where: "the rig's transport (bench/transport.js), applied to this arm too",
    cut: "upstream's tolerance for a reply that ran out of tokens",
    why: "the rig calls the endpoint through THIS TREE's `src/core/inference/OpenAICompatible.js`, which classifies every reply into four states and REFUSES two of them — the scratchpad arriving on the answer channel, and a reply whose answer never began. Upstream agent-zero has no such classifier; litellm hands it whatever came back. The refusal is applied by the driver, identically, to both arms on the same inputs, which is what makes it a constant of the experiment rather than a thumb on the scale — but it is a component of OUR harness and this arm does not have it, so it is listed here. Measured over the runs in `transcripts/`: it refuses ZERO of this arm's 79 replies and TWELVE of the other arm's 34, so on the evidence so far this row costs this arm nothing and the other arm a great deal. Any run where `stop` is `transport-refused` was ended by this row.",
  },
  {
    where: 'no cut — recorded because it looks like one',
    cut: 'agent-zero is given no list_files tool',
    why: 'it does not have one. Directory listing in agent-zero is `code_execution_tool` with runtime terminal and `ls`, which reaches the same tools.js `run` our scaffold reaches. The capability is present; only the naming differs, and the naming is the scaffold under test.',
  },
])

// ── the system prompt ──────────────────────────────────────────────────────

/** prompts/agent.system.main.environment.md, replaced. See CUTS. */
function environmentSection(workdir) {
  return [
    '## Environment',
    'you run on a macOS host inside a bun process, not in a container',
    `your working directory is ${workdir} and every path you use is relative to it`,
    'the shell is /bin/sh, one command per call, killed after 30 seconds',
    'python3 and node are installed and on PATH',
    'there is no persistent terminal session: each command starts fresh in the working directory',
    '',
  ].join('\n')
}

/**
 * A cut, applied and CHECKED.
 *
 * `String.replace` with a pattern that no longer matches returns the string
 * unchanged and says nothing. Every entry in `CUTS` is a promise removed from
 * agent-zero's prompt because this rig cannot keep it, so a silently-missed cut
 * leaves the reference scaffold reaching for a tool that does not exist — and
 * it would look like agent-zero wasting its turns rather than like this file
 * drifting off its vendored copy. Misses are collected and `missedCuts()`
 * reports them; `test/bench/agentZeroScaffold.test.js` fails on a non-empty
 * report, so a vendor bump that breaks a cut is a red test and not a quiet
 * change in what the comparison measures.
 */
const MISSED = []

function cut(text, pattern, replacement = '') {
  const out = text.replace(pattern, replacement)
  if (out === text)
    MISSED.push(typeof pattern === 'string' ? pattern.split('\n')[0] : String(pattern))
  return out
}

/** Every cut whose pattern did not match the vendored text. Empty is correct. */
export function missedCuts() {
  return [...MISSED]
}

function mainPrompt(workdir) {
  // agent.system.main.md is `# Agent Zero System Manual` plus six includes. We
  // read it exactly, then apply the CUTS to the sections that name cut tools.
  MISSED.length = 0
  let text = readPrompt('agent.system.main.md', { workdir_path: workdir })

  // environment: replace the container description with the true one.
  text = cut(
    text,
    /## Environment[\s\S]*?(?=\n## Communication)/,
    `${environmentSection(workdir)}\n`,
  )

  // solving: drop the lines that name memory, skills and subordinates.
  const solvingCuts = [
    '1 check memories solutions skills prefer skills\nmemories are stable preferences facts constraints not task history\n',
    'you can use subordinates for specific subtasks\ncall_subordinate tool\nuse prompt profiles to specialize subordinates\nnever delegate full to subordinate of same profile as you\nalways describe role for new subordinate\nthey must execute their assigned tasks\n',
    'save durable info with memorize only when useful across future work\ndo not memorize one-off commands temp state task actions or implementation minutiae\n',
  ]
  for (const chunk of solvingCuts) text = cut(text, chunk)
  text = cut(text, '3 solve or delegate\ntools solve subtasks\n', '3 solve\ntools solve subtasks\n')

  // solving.md's coding checklist references the cut `patch` action.
  text = cut(text, '- if tool patch fails inspect current file and retry with smaller context\n')

  // tips: drop memory, skills, subordinates, documents/OCR.
  text = cut(text, 'memory refers memory tools not own knowledge\n')
  text = cut(text, /## Skills\n\nskills are contextual expertise[\s\S]*?skills_tool\n\n/)
  text = cut(
    text,
    'always use specialized subordinate agents for specialized tasks matching their prompt profile\n',
  )
  text = cut(text, /\n## Documents and OCR\n[\s\S]*$/, '\n')

  // communication: drop the parallel-tool line and the replacements section.
  text = cut(
    text,
    '- To do independent operations concurrently, use only the listed `parallel` tool\n',
  )
  text = cut(
    text,
    /\n## replacements\n[\s\S]*?prefer include over rewriting long existing text\n/,
    '\n',
  )

  return text
}

/**
 * The three tool prompts we keep, with their own cuts applied, then wrapped in
 * agent.system.tools.md exactly as _11_tools_prompt.py does.
 */
function toolsPrompt() {
  // readPrompt has already resolved the `{{ include }}`, so the tips file's one
  // line is cut by its text rather than by its include directive.
  let response = readPrompt('agent.system.tool.response.md')
  response = cut(response, 'for long existing text, use `§§include(path)` instead of rewriting\n')

  let codeExe = readPrompt('agent.system.tool.code_exe.md')
  const codeExeCuts = [
    [
      '- `runtime`: `terminal`, `python`, `nodejs`, or `output`\n',
      '- `runtime`: `terminal`, `python`, or `nodejs`\n',
    ],
    ['- `session`: terminal session id; default `0`\n'],
    ['- `reset`: kill a session before running; `true` or `false`\n'],
    ['- use `runtime=output` to poll running work\n'],
    ['- use `input` for interactive terminal prompts\n'],
    ['- if a session is stuck, call again with the same `session` and `reset=true`\n'],
    ['- do not interleave other tools while waiting\n'],
    [
      '- treat trailing framework `[SYSTEM: ...]` info as execution status, not command output; use it to decide whether to wait, reset, rerun, or continue\n',
    ],
    [
      '- for builds installs servers training and long tests, redirect logs and poll with `runtime=output`\n',
    ],
    ['- after timeout or pause, inspect logs and processes before deciding wait reset or stop\n'],
    [
      '- never claim success from timeout partial output or a still-running command\n',
      '- never claim success from partial output\n',
    ],
    ['- stop stale background processes you started before final response\n'],
    // the examples still carry session/reset keys; strip those two lines so the
    // demonstrated call shape matches the argument list above it.
    [/^\s*"session": 0,?\n/gm],
    [/^\s*"reset": false,?\n/gm],
    // examples 4 and the duplicate 3 are both runtime=output polling.
    [/4 wait for output with long-running scripts[\s\S]*?~~~\n/],
    [/3 wait for running output[\s\S]*?~~~\n/],
  ]
  for (const [pattern, replacement] of codeExeCuts) codeExe = cut(codeExe, pattern, replacement)

  let editor = readPrompt('agent.system.tool.text_editor.md', { default_line_count: '' })
  const editorCuts = [
    [/#### patch[\s\S]*$/],
    ['actions: read write patch\n', 'actions: read write\n'],
    [
      'canonical text and Markdown file read write patch with numbered lines\n',
      'canonical text file read and write\n',
    ],
    [
      'common args: action path\noptional UI intent args: open_in_canvas\n',
      'common args: action path\n',
    ],
    [
      /use this tool for Markdown and plain text files; use `office_artifact`[\s\S]*?refresh automatically\n/,
    ],
    [
      'read file with numbered lines\nargs path line_from line_to (inclusive optional)\nno range -> first  lines\nlong lines cropped output may trim by token limit\nread surrounding context before patching\n',
      'read a whole file\nargs path\n',
    ],
    [/^\s*"line_from": 1,\n/m],
    [/^\s*"line_to": 50\n/m],
    ['"path": "/path/file.py",\n', '"path": "/path/file.py"\n'],
    [/for Markdown files, include `open_in_canvas: true`[^\n]*\n/g],
  ]
  for (const [pattern, replacement] of editorCuts) editor = cut(editor, pattern, replacement)

  const tools = [response, codeExe, editor].map((part) => part.trim()).join('\n\n')

  let wrapper = readPrompt('agent.system.tools.md', { tools })
  wrapper = cut(
    wrapper,
    'Do not invent top-level `multi` or generic batch tools. The only listed wrapper for independent concurrent calls is `parallel`; otherwise call one listed tool at a time. If a tool has an action named `multi`, keep that action inside `tool_args.action` for that specific tool.\n',
    'Do not invent top-level `multi` or generic batch tools. Call one listed tool at a time.\n',
  )
  return wrapper
}

export function buildSystemPrompt(workdir) {
  // agent.py:583 — join then strip the ```json fences off the examples.
  return removeJsonFences([mainPrompt(workdir), toolsPrompt()].join('\n\n'))
}

// ── the JSON tool-call contract, reproduced ────────────────────────────────

const jsonCompact = (value) => JSON.stringify(value)

/**
 * agent-zero/helpers/extract_tools.py:79-128 normalize_tool_request, exactly.
 * Throws on a request that does not normalise, which the caller reads as
 * "misformat" — the same branch agent.py:1434-1439 takes.
 */
function normalizeToolRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Tool request must be a dictionary')
  }
  let req = request
  if (!req.tool_name && !req.tool && 'actions' in req) {
    const actions = req.actions
    if (!Array.isArray(actions) || actions.length !== 1 || typeof actions[0] !== 'object') {
      throw new Error('Tool request actions wrapper must contain exactly one dictionary')
    }
    req = actions[0]
  }
  let name = typeof req.tool_name === 'string' && req.tool_name ? req.tool_name : ''
  if (!name && typeof req.tool === 'string') name = req.tool
  if (!name && req.type === 'function' && typeof req.name === 'string') name = req.name
  if (!name) throw new Error('Tool request must have a tool_name (type string) field')

  let args = req.tool_args
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = req.args
  if ((!args || typeof args !== 'object' || Array.isArray(args)) && req.type === 'function') {
    args = req.parameters
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Tool request must have a tool_args (type dictionary) field')
  }
  args = { ...args }
  if (name.includes(':')) {
    const at = name.indexOf(':')
    const head = name.slice(0, at)
    const action = name.slice(at + 1)
    if (!head || !action) throw new Error('tool_name method suffix must include tool and action')
    name = head
    if (!('action' in args)) args.action = action
  }
  if (!('action' in args) && typeof args.method === 'string' && args.method) {
    args.action = args.method
  }
  return { name, args }
}

/**
 * agent-zero/helpers/extract_tools.py:23-36 extract_tool_request.
 *
 * The OUTER strictness is the point and is faithful: the reply must be a single
 * complete JSON object and NOTHING else — no prose, no fence, no second object,
 * nothing unterminated — and how often a scaffold's contract survives contact
 * with a model is exactly what this rig measures.
 *
 * The INTERIOR leniency is NOT reproduced, and that is a departure that makes
 * this arm worse rather than better. Upstream parses the object with
 * `DirtyJson`, which accepts a trailing comma, single quotes and unquoted keys;
 * `JSON.parse` does not, so those three shapes are scored `misformat` here and
 * are tool calls there. It is a row in CUTS rather than a port because a
 * hand-written tolerant parser would be a reconstruction whose fidelity nothing
 * in the gate could check — DirtyJson also accepts `// comments` and bare word
 * values, and rejects `NaN` — and a guess that LOOKS like fidelity is worse
 * than a disclosed gap. The oracle is vendored at
 * `vendor/agent-zero/helpers/extract_tools.py` so the divergence can be
 * re-derived here rather than in someone's temp directory.
 */
function extractToolRequest(content) {
  const text = String(content ?? '').trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return null
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  try {
    normalizeToolRequest(parsed)
  } catch {
    return null
  }
  return parsed
}

// ── the scaffold object the driver drives ─────────────────────────────────

const MISFORMAT =
  'You have misformatted your message. Follow system prompt instructions on JSON message formatting precisely.'
const REPEAT = 'You have sent the same message again. You have to do something else!'
/** settings.py.dox.md:72 — the cost circuit breaker. */
const UNUSABLE_LIMIT = 5

function fileTree(dir, depth = 0, maxDepth = 5) {
  // A stand-in for helpers/file_tree.file_tree with the default settings
  // (depth 5, 20 files, 20 folders). Same shape: an indented listing.
  if (depth > maxDepth) return []
  let names
  try {
    names = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
  const lines = []
  for (const entry of names.slice(0, 40)) {
    lines.push(`${'  '.repeat(depth)}${entry.name}${entry.isDirectory() ? '/' : ''}`)
    if (entry.isDirectory()) lines.push(...fileTree(join(dir, entry.name), depth + 1, maxDepth))
  }
  return lines
}

export const scaffold = {
  id: 'agent-zero',
  label: 'agent-zero (frdel/agent-zero @ 6a6cecf)',
  cuts: CUTS,

  init({ task, tools }) {
    return {
      workdir: tools.workdir,
      system: buildSystemPrompt(tools.workdir),
      // Each entry is {ai: boolean, content: string|object} — agent-zero's
      // history.Message shape, minus everything the rig does not need.
      history: [
        // agent.py:739-763; fw.user_message.md is a full JSON template so its
        // content is a dict, and empty keys are dropped (agent.py:759-760).
        { ai: false, content: { user_message: task.prompt } },
      ],
      lastResponse: '',
      unusable: 0,
      stopped: '',
    }
  },

  request(state) {
    // extras, rebuilt every call and never stored — agent.py:594-599.
    const extras = {
      current_datetime: readPrompt('agent.system.datetime.md', {
        date_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
      }),
      agent_info: readPrompt('agent.extras.agent_info.md', {
        number: 0,
        profile: 'Default',
        llm: 'openai_compatible/local',
        preset: '',
      }),
      project_file_structure: readPrompt('agent.extras.workdir_structure.md', {
        folder: state.workdir,
        max_depth: 5,
        gitignore: 'nothing ignored',
        file_structure: fileTree(state.workdir).join('\n') || '(empty)',
      }),
    }
    const extrasMessage = {
      ai: false,
      content: readPrompt('agent.context.extras.md', { extras: jsonCompact(extras) }),
    }

    // history.py:679-688 — a dict content becomes compact JSON.
    const flat = [...state.history, extrasMessage].map((m) => ({
      ai: m.ai,
      text: typeof m.content === 'string' ? m.content : jsonCompact(m.content),
    }))

    // history.py:704-713 — merge adjacent same-role, drop a leading assistant.
    const merged = []
    for (const m of flat) {
      if (!m.text?.trim()) continue
      const last = merged.at(-1)
      if (last && last.ai === m.ai) last.text = `${last.text}\n${m.text}`
      else merged.push({ ...m })
    }
    while (merged.length && merged[0].ai) merged.shift()

    return {
      messages: [
        { role: 'system', content: state.system },
        ...merged.map((m) => ({ role: m.ai ? 'assistant' : 'user', content: m.text })),
      ],
    }
  },

  parse(replyText, state) {
    const text = String(replyText ?? '')

    // _30_repeat_response.py:26-28 — an identical reply is refused before it is
    // even parsed.
    if (text && text === state.lastResponse) {
      return { kind: 'malformed', reason: 'repeat', note: REPEAT, raw: text }
    }
    if (!text.trim()) {
      return {
        kind: 'malformed',
        reason: 'empty',
        note: 'Model returned an empty response (no reasoning, no content).',
        raw: text,
      }
    }

    const request = extractToolRequest(text)
    if (!request) {
      return { kind: 'malformed', reason: 'misformat', note: MISFORMAT, raw: text }
    }
    const { name, args } = normalizeToolRequest(request)
    if (name === 'response') {
      return { kind: 'answer', tool: name, args, text: String(args.text ?? ''), raw: text }
    }
    return { kind: 'tool', tool: name, args, raw: text }
  },

  /**
   * Run the requested tool through the SHARED implementations in tools.js.
   *
   * Every branch here ends at one of the four. agent-zero's tool naming is
   * preserved because the naming is part of the scaffold; the behaviour behind
   * the name is not agent-zero's and not ours.
   */
  async act(action, _state, tools) {
    if (action.kind === 'malformed') {
      return { observation: action.note, ran: [] }
    }
    const { tool, args } = action

    if (tool === 'code_execution_tool') {
      const runtime = String(args.runtime ?? 'terminal').toLowerCase()
      const code = String(args.code ?? '')
      let command
      if (runtime === 'python') command = `cat <<'A0EOF' | python3\n${code}\nA0EOF`
      else if (runtime === 'nodejs' || runtime === 'node')
        command = `cat <<'A0EOF' | node\n${code}\nA0EOF`
      else if (runtime === 'terminal' || runtime === 'shell' || !runtime) command = code
      else {
        return {
          observation: `unknown runtime '${runtime}'. Use terminal, python or nodejs.`,
          ran: [],
        }
      }
      const result = await tools.run({ command })
      return { observation: result.output, ran: [{ name: 'run', args: { command } }] }
    }

    if (tool === 'text_editor') {
      const act = String(args.action ?? '').toLowerCase()
      if (act === 'read') {
        const result = await tools.read_file({ path: args.path })
        return {
          observation: result.output,
          ran: [{ name: 'read_file', args: { path: args.path } }],
        }
      }
      if (act === 'write') {
        const result = await tools.write_file({ path: args.path, content: args.content })
        return {
          observation: result.output,
          ran: [{ name: 'write_file', args: { path: args.path } }],
        }
      }
      return {
        observation: `unknown text_editor action '${act}'. Use read or write.`,
        ran: [],
      }
    }

    // agent.py:1510-1517 — an unlisted tool name is a plain-text warning.
    // No `unknownTool` flag: it was set here and read nowhere, because the
    // driver builds `observe`'s argument itself and never forwarded the result
    // of `act`. `observe` below tests the sentence instead, which is what
    // actually runs.
    return { observation: `Tool '${tool}' not found or could not be initialized.`, ran: [] }
  },

  observe(state, { action, observation }) {
    state.lastResponse = action.raw ?? ''

    if (action.kind === 'malformed') {
      // agent.py:780-782 — fw.warning.md is a full JSON template, so a warning
      // enters history as {"system_warning": "..."}.
      state.history.push({ ai: true, content: action.raw ?? '' })
      state.history.push({ ai: false, content: { system_warning: observation } })
      state.unusable += 1
      if (state.unusable >= UNUSABLE_LIMIT) {
        state.stopped = `agent stopped after ${UNUSABLE_LIMIT} consecutive unusable model responses`
      }
      return
    }

    state.unusable = 0
    state.history.push({ ai: true, content: action.raw ?? '' })
    if (observation.startsWith("Tool '")) {
      state.history.push({ ai: false, content: { system_warning: observation } })
      return
    }
    // agent.py:785-807 — the tool result is a USER message carrying a dict.
    state.history.push({
      ai: false,
      content: { tool_name: action.tool, tool_result: observation },
    })
  },

  /**
   * agent-zero's own circuit breaker: five consecutive unusable replies and it
   * stops rather than keep paying for them.
   * _90_stop_unusable_response_loop.py, limit 5 (settings.py.dox.md:72).
   */
  stopped(state) {
    return state.stopped && state.stopped !== 'turn cap' ? state.stopped : ''
  },

  /** The driver's cap is the rig's, not agent-zero's; agent-zero has none here. */
  onCap(state) {
    state.stopped = state.stopped || 'turn cap'
  },
}

export default scaffold
