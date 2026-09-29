/** Trusted, desk-shipped module groups. Imported folders cannot extend this registry. */
export const BUILTIN_TOOL_GROUPS = Object.freeze(['board', 'files', 'host', 'web', 'skill', 'memory', 'sessions', 'todo', 'schedule', 'workspace'])
// MCP is supplied by the desk's configured connections, not a local JS module.
export const SUPPORTED_BUILTIN_GROUPS = Object.freeze([...BUILTIN_TOOL_GROUPS, 'mcp'])
// Deferred work currently starts outside the originating run's policy/binding.
// Imported packages must not receive it until that authority is persisted safely.
export const IMPORTABLE_TOOL_GROUPS = Object.freeze(SUPPORTED_BUILTIN_GROUPS.filter(name => name !== 'schedule'))
