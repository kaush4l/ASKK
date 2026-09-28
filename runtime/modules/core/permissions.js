/**
 * Permissions and guardrails — what a tool call may do before it runs.
 *
 *     decide(tool, args, {policy, agent})   →   {action: 'allow'|'ask'|'deny', risk, reason}
 *
 * Every tool has a risk class:
 *   read   looks at something and changes nothing      (board_list, memory_search, host_read)
 *   net    reaches the network                          (web_fetch, host_fetch)
 *   write  changes state the owner cares about          (host_write, files_write, local tools by default)
 *   exec   runs a program on the owner's machine        (host_exec)
 *
 * A policy maps risks and tool names to actions. The most specific rule wins:
 *   rules[agent][toolName] > rules[agent][risk] > rules['*'][toolName] > rules['*'][risk] > defaults[risk]
 *
 * Guardrails come before the policy and cannot be allowed away: a call that matches one is
 * denied with its reason, whatever any rule says. They are few on purpose — a long denylist is
 * a list of spellings to route around. The real boundary for the machine is the host bridge,
 * which confines every path to its root and runs as the owner only after pairing.
 */

export const RISKS = ['read', 'net', 'write', 'exec']

export const DEFAULT_POLICY = {
  defaults: { read: 'allow', net: 'allow', write: 'ask', exec: 'ask' },
  rules: {},
}

const GUARDRAILS = [
  { test: /\brm\s+-[a-z]*\s+(\/|~|\$HOME)(\s|$|\*)/i, reason: 'removes the root or home directory' },
  { test: /(^|[\s;&|])(sudo|doas)\s/, reason: 'asks for superuser rights' },
  { test: /\b(curl|wget)\b[^|\n]*\|\s*(ba|z)?sh\b/, reason: 'pipes a download into a shell' },
  { test: /\bmkfs\b|\bdd\s+if=\S+\s+of=\/dev\//, reason: 'writes to a raw device' },
  { test: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'is a fork bomb' },
  { test: /\bgit\s+push\b[^\n]*(--force\b|\s-f\b)/, reason: 'force-pushes history' },
]

/** The risk class of a tool: what it declares, else `write` for anything not built in. */
export function riskOf(item) {
  if (item.risk && RISKS.includes(item.risk)) return item.risk
  if (item.tier === 'agent') return 'read'
  return 'write'
}

/** The guardrail a call trips, or null. Looks at every string argument. */
export function guardrail(args = {}) {
  const text = Object.values(args ?? {})
    .filter((value) => typeof value === 'string')
    .join('\n')
  for (const rail of GUARDRAILS) if (rail.test.test(text)) return rail.reason
  return null
}

/** Decide one call. */
export function decide(item, args = {}, { policy = DEFAULT_POLICY, agent = '*' } = {}) {
  const risk = riskOf(item)
  const tripped = guardrail(args)
  if (tripped) return { action: 'deny', risk, reason: `guardrail: the call ${tripped}` }
  const defaults = { ...DEFAULT_POLICY.defaults, ...(policy.defaults ?? {}) }
  const rules = policy.rules ?? {}
  const own = rules[agent] ?? {}
  const any = rules['*'] ?? {}
  const found = [
    [own[item.name], `${agent} rule for ${item.name}`],
    [own[risk], `${agent} rule for ${risk}`],
    [any[item.name], `rule for ${item.name}`],
    [any[risk], `rule for ${risk}`],
    [defaults[risk], `default for ${risk}`],
  ].find(([action]) => ['allow', 'ask', 'deny'].includes(action))
  const [action, reason] = found ?? ['ask', 'no rule']
  return { action, risk, reason }
}

/** Lay an agent's frontmatter `permissions:` under the owner's saved rules for that agent. */
export function withAgentRules(policy = DEFAULT_POLICY, agent, fromFile = {}) {
  const rules = { ...(policy.rules ?? {}) }
  rules[agent] = { ...(fromFile ?? {}), ...(rules[agent] ?? {}) }
  return { defaults: { ...DEFAULT_POLICY.defaults, ...(policy.defaults ?? {}) }, rules }
}
