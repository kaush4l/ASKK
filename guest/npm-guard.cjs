#!/usr/bin/env node
// Preserve npm's CLI while protecting the image's generated dependency link from accidental installation.
const fs = require('node:fs')
const path = require('node:path')
// Scripts are intentionally allowed; this is an accidental dependency-write guard,
// not a sandbox for arbitrary shell commands launched by an npm script.
const nonDependencyCommands = new Set(['run', 'run-script', 'start', 'stop', 'restart', 'test', 'ls', 'list', 'll', 'la', 'outdated', 'view', 'info', 'show', 'help', 'explain', 'why', 'root', 'prefix', 'ping', 'fund'])
const valueOptions = new Set(['--prefix', '-C', '--cache', '--registry', '--userconfig', '--globalconfig', '--workspace', '-w', '--loglevel', '--location', '--tag', '--scope', '--access', '--omit', '--include', '--install-strategy', '--depth', '--fetch-retries', '--fetch-timeout', '--fetch-retry-mintimeout', '--fetch-retry-maxtimeout', '--logs-max', '--node-options', '--script-shell'])
const booleanOptions = new Set(['audit', 'fund', 'ignore-scripts', 'foreground-scripts', 'package-lock', 'package-lock-only', 'save', 'save-dev', 'save-prod', 'save-optional', 'save-peer', 'save-exact', 'dry-run', 'force', 'global', 'local', 'offline', 'prefer-offline', 'prefer-online', 'legacy-peer-deps', 'strict-peer-deps', 'workspaces', 'include-workspace-root', 'json', 'parseable', 'long', 'help', 'version', 'yes', 'silent', 'verbose', 'progress', 'color', 'timing', 'if-present', 'bin-links', 'engine-strict'])
const shortFlags = new Set(['-g', '-f', '-D', '-P', '-O', '-E', '-S', '-y', '-s', '-d', '-dd', '-ddd', '-q', '-v', '-h', '-l', '-p'])
const fail = (code, message) => Object.assign(new Error(message), { code })

function npmInvocation(cwd, args) {
  let base = path.resolve(cwd), command = null, positional = false, explicitPrefix = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (positional) { command ||= arg; continue }
    if (arg === '--') { positional = true; continue }
    if (!arg.startsWith('-')) { command ||= arg; continue }
    const equal = arg.indexOf('='); const option = equal < 0 ? arg : arg.slice(0, equal)
    if (valueOptions.has(option)) {
      const value = equal < 0 ? args[++i] : arg.slice(equal + 1)
      if (!value || value.startsWith('-')) throw fail('UNSUPPORTED_NPM_ARGUMENTS', `Missing or ambiguous value for ${option}; use an explicit npm option value`)
      if (option === '--prefix' || option === '-C') { base = path.resolve(cwd, value); explicitPrefix = true }
      continue
    }
    const boolean = option.startsWith('--') ? option.slice(2).replace(/^no-/, '') : null
    if (shortFlags.has(option) && equal < 0 || booleanOptions.has(boolean) && (equal < 0 || ['true', 'false'].includes(arg.slice(equal + 1)))) continue
    // Never guess whether an unknown flag consumes the following command word.
    throw fail('UNSUPPORTED_NPM_ARGUMENTS', `Unsupported npm option ${option} in the template guard; use a supported explicit option, and put script arguments after --`)
  }
  return { base, command, explicitPrefix }
}

function assertNpmTemplateSafety({ cwd = process.cwd(), args = process.argv.slice(2), templateRoot = '/opt/harness/template', env = process.env } = {}) {
  const { base, command, explicitPrefix } = npmInvocation(cwd, args)
  if (!command || nonDependencyCommands.has(command)) return
  const template = fs.realpathSync(templateRoot), target = path.join(template, 'node_modules')
  const deny = () => { throw fail('GENERATED_DEPENDENCIES_READ_ONLY', 'This project uses the pinned image template. Run node /opt/harness/prepare-template.js --detach before installing or changing dependencies.') }
  // npm scripts can inherit a global npm_config_prefix while their actual local
  // installation still targets cwd. An environment prefix must never replace
  // the cwd check; an explicit CLI prefix can select a different project.
  const bases = new Set([base])
  const environmentPrefix = env.npm_config_prefix || env.NPM_CONFIG_PREFIX
  if (!explicitPrefix && environmentPrefix) bases.add(path.resolve(cwd, environmentPrefix))
  for (const start of bases) for (let directory = start; ; directory = path.dirname(directory)) {
    try {
      const actual = fs.realpathSync(directory)
      if (actual === template || actual.startsWith(`${template}${path.sep}`)) deny()
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const modules = path.join(directory, 'node_modules')
    try {
      if (fs.lstatSync(modules).isSymbolicLink() && path.resolve(directory, fs.readlinkSync(modules)) === target) deny()
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (path.dirname(directory) === directory) break
  }
}
module.exports = { assertNpmTemplateSafety }
if (require.main === module) {
  try { assertNpmTemplateSafety() }
  catch (error) { console.error(`${error.code}: ${error.message}`); process.exit(1) }
  require('/usr/local/lib/node_modules/npm/bin/npm-cli.js')
}
