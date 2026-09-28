/**
 * Built-in `host` — the owner's machine, through the host bridge (host/bridge.js).
 *
 * These tools exist only when the bridge is paired (`requires: ['host']`); otherwise they are
 * left out of the prompt and listed as unavailable. Every path is confined to the bridge's
 * root by the bridge itself, not by this file. The hub makes the call, from the page, because
 * the page is where the browser's local-network permission was granted.
 */

const bridge = (ctx, endpoint, body) => ctx.request('host', { endpoint, body })

export const host_exec = {
  description:
    'Run a shell command on the owner machine, inside the bridge root. Returns the exit code, stdout and stderr. ' +
    'Long output is cut. Use it to build, test and inspect.',
  parameters: { command: 'string', cwd: 'string (optional, relative to the root)', timeout: 'seconds (optional, default 120)' },
  requires: ['host'],
  risk: 'exec',
  run: async ({ command, cwd, timeout }, ctx) => {
    const result = await bridge(ctx, '/exec', { command, cwd, timeout })
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    return `exit ${result.code}${result.timedOut ? ' (timed out)' : ''}${output ? `\n${output}` : ' (no output)'}`
  },
}

export const host_list = {
  description: 'List a directory under the bridge root. Directories end with /.',
  parameters: { path: 'string (relative to the root, default ".")' },
  requires: ['host'],
  risk: 'read',
  run: async ({ path = '.' }, ctx) => {
    const { entries } = await bridge(ctx, '/fs/list', { path })
    return entries.length ? entries.join('\n') : '(empty)'
  },
}

export const host_read = {
  description: 'Read a text file under the bridge root. Large files are cut; pass start and lines to read a window.',
  parameters: { path: 'string', start: 'line number (optional)', lines: 'count (optional)' },
  requires: ['host'],
  risk: 'read',
  run: async ({ path, start, lines }, ctx) => {
    const { content, truncated } = await bridge(ctx, '/fs/read', { path, start, lines })
    return truncated ? `${content}\n… (cut; read a window with start and lines)` : content
  },
}

export const host_write = {
  description: 'Write a whole text file under the bridge root, creating folders as needed. Read it first if it exists.',
  parameters: { path: 'string', content: 'string' },
  requires: ['host'],
  risk: 'write',
  writes: true,
  run: async ({ path, content }, ctx) => {
    const { bytes } = await bridge(ctx, '/fs/write', { path, content: String(content ?? '') })
    return `wrote ${path}, ${bytes} bytes`
  },
}

export const host_fetch = {
  description: 'Fetch a URL from the owner machine, for sites a browser page cannot reach. Returns text, cut when long.',
  parameters: { url: 'string' },
  requires: ['host'],
  risk: 'net',
  run: async ({ url }, ctx) => {
    const { status, text } = await bridge(ctx, '/fetch', { url })
    return `HTTP ${status}\n<untrusted source="${url}">\n${text}\n</untrusted>`
  },
}

/**
 * A coding agent CLI on the owner's machine, with its own tools on, given one task. It works in
 * the bridge root and edits files there itself, so the call is `exec`: the owner is asked. Each
 * preset is set to edit without prompting (nothing can answer its prompts) and to leave shell
 * commands to its own rules. Claude's stream is read for the final result and the tools it used.
 */
const AGENTS = {
  claude: ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--no-session-persistence'],
  codex: ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--color', 'never', '-'],
  gemini: ['--approval-mode', 'auto_edit', '--output-format', 'text'],
}

export const host_agent = {
  description:
    'Hand one self-contained coding task to a coding agent CLI on the owner machine (claude, codex or gemini). ' +
    'It reads and edits files in the bridge root with its own tools and returns its final report. ' +
    'Give it everything it needs in the task: it sees nothing of this conversation. Slow: minutes, not seconds.',
  parameters: { agent: 'claude | codex | gemini', task: 'string', cwd: 'string (optional, relative to the root)', timeout: 'seconds (optional, default 900)' },
  requires: ['host'],
  risk: 'exec',
  run: async ({ agent = 'claude', task, cwd, timeout = 900 }, ctx) => {
    const args = AGENTS[agent]
    if (!args) return `no coding agent "${agent}"; use one of: ${Object.keys(AGENTS).join(', ')}`
    if (!ctx.host?.capabilities?.includes('cli')) return 'the bridge has cli switched off (--no-cli)'
    const result = await bridge(ctx, '/run', { program: agent, args, stdin: String(task ?? ''), cwd, timeout })
    const report = agent === 'claude' ? claudeReport(result.out) : { text: result.out.trim(), used: [] }
    const failed = result.code !== 0 ? `exit ${result.code}${result.timedOut ? ' (timed out)' : ''}\n${result.err.trim().slice(-800)}\n` : ''
    const used = report.used.length ? `\n(tools it used: ${report.used.join(', ')})` : ''
    return `${failed}${report.text || '(no report)'}${used}`.slice(0, 12000)
  },
}

function claudeReport(out) {
  const used = new Map()
  let text = ''
  for (const line of out.split('\n')) {
    let item
    try {
      item = JSON.parse(line)
    } catch {
      continue
    }
    if (item.type === 'assistant') for (const part of item.message?.content ?? []) if (part.type === 'tool_use') used.set(part.name, (used.get(part.name) ?? 0) + 1)
    if (item.type === 'result') text = item.is_error ? `claude failed: ${item.result ?? item.subtype}` : String(item.result ?? '')
  }
  return { text, used: [...used].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)) }
}
