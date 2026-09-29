import { normalizeCompletion } from './completion.js'

const fail = message => { throw Object.assign(new TypeError(`Invalid workspace command: ${message}`), { code: 'COMMAND_REFERENCE' }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))

/** Resolve trusted configuration before policy; adapters revalidate the resolved pair. */
export function resolveCommandReference(args, completion, { resolved = false } = {}) {
  if (!plain(args) || Reflect.ownKeys(args).some(key => !['command', 'requiredCheck'].includes(key))) fail('expected only command or requiredCheck')
  const hasCommand = Object.hasOwn(args, 'command')
  const hasReference = Object.hasOwn(args, 'requiredCheck')
  if (!hasCommand && !hasReference || !resolved && hasCommand && hasReference) fail('provide exactly one of command or requiredCheck')
  if (resolved && !hasCommand) fail('adapter requires a resolved command')
  if (hasCommand && (typeof args.command !== 'string' || !args.command.trim() || args.command.includes('\0'))) fail('command must be a nonempty string without NUL')
  if (!hasReference) return Object.freeze({ command: args.command })
  if (!Number.isSafeInteger(args.requiredCheck) || args.requiredCheck < 0) fail('requiredCheck must be a zero-based integer')
  const contract = normalizeCompletion(completion)
  const commands = contract.checks.find(check => check.capability === 'workspace.commands')?.options.commands
  if (!commands || args.requiredCheck >= commands.length) fail('requiredCheck is outside the configured command list')
  const command = commands[args.requiredCheck]
  if (hasCommand && args.command !== command) fail('resolved command does not match requiredCheck')
  return Object.freeze({ command, requiredCheck: args.requiredCheck })
}
