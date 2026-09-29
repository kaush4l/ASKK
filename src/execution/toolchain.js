/** Command semantics supplied by an adapter, not executable discovery or a probe receipt. */
export function describeToolchain({ kind = 'unknown', version, packageManager, ...details } = {}) {
  const toolchain = { kind, version, ...details }
  if (packageManager) toolchain.packageManager = packageManager
  if (kind === 'bun') {
    toolchain.packageManager ??= 'bun'
    toolchain.commandFacts = {
      source: 'adapter-command-semantics', executionVerified: false,
      testRunner: 'bun test',
      packageScript: 'bun run <name>',
      semantics: 'bun test invokes the built-in test runner. bun run <name> invokes the named package.json script. A scripts.test value of "bun run test" calls itself recursively; use "bun test" to invoke the built-in runner from that script.',
    }
  } else if (kind === 'node' && packageManager === 'npm') {
    toolchain.commandFacts = {
      source: 'adapter-command-semantics', executionVerified: false,
      packageScript: 'npm run <name>', testScript: 'npm test',
      semantics: 'npm run <name> invokes the named package.json script. npm test invokes scripts.test; it is not a test runner. A scripts.test value of "npm test" or "npm run test" calls itself recursively; that script must invoke the project test runner.',
    }
  }
  return toolchain
}
