#!/usr/bin/env bun
/** Explicit native acceptance only. Does not run when imported or without --execute. */
import { chmod, lstat, mkdir, readFile, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { buildPackage, sha256, verifyPackage } from './package.js'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const requireTrue = (condition, message) => { if (!condition) throw new Error(message) }
export const acceptanceHelp = `Explicit native acceptance (starts HTTPS companion, PTYs and a Next build):
bun scripts/companion/acceptance.js --execute --directory /new/private/receipt-directory \\
  --tls-cert /external/loopback.pem --tls-key /external/loopback-key.pem \\
  --tls-ca /external/public-rootCA.pem [--port 7797]
The directory must not exist. Nothing is executed without --execute.
Uses existing pinned repository node_modules; installs nothing. Never prints tokens.
No browser trust or browser Linux success is inferred from this native probe.`

export function parseAcceptanceOptions(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true }
  const options = {}; const names = new Set(['directory', 'tls-cert', 'tls-key', 'tls-ca', 'port'])
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execute') { if (options.execute) throw new Error('Duplicate --execute'); options.execute = true; continue }
    const name = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--') || !names.has(name) || options[name] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid acceptance option: ${argv[i]}`)
    options[name] = argv[++i]
  }
  if (!options.execute) throw new Error('Explicit --execute is required before any package/server/build work')
  for (const key of ['directory', 'tls-cert', 'tls-key', 'tls-ca']) if (!isAbsolute(options[key] ?? '') || /[\u0000-\u001f\u007f]/.test(options[key])) throw new Error(`--${key} requires an absolute path`)
  const port = options.port ?? '7797'
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) throw new Error('Invalid acceptance port')
  return { ...options, port: Number(port), directory: resolve(options.directory) }
}

export function nextFixture(dependencies) {
  for (const name of ['next', 'react', 'react-dom']) if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(dependencies[name] ?? '')) throw new Error(`Fixture requires exact installed ${name} version`)
  return {
    'package.json': `${JSON.stringify({ name: 'askk-packaged-companion-proof', private: true, type: 'module', scripts: { build: 'next build --webpack' }, dependencies: Object.fromEntries(['next', 'react', 'react-dom'].map(name => [name, dependencies[name]])) }, null, 2)}\n`,
    'next.config.mjs': "export default {output:'export',images:{unoptimized:true},experimental:{cpus:1}}\n",
    'app/layout.jsx': "export default function Layout({children}){return <html lang=\"en\"><body>{children}</body></html>}\n",
    'app/page.jsx': "export default function Page(){return <main><h1>Packaged companion proof</h1><p>Native static export</p></main>}\n",
  }
}

async function bounded(promise, milliseconds, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
async function until(check, milliseconds = 10000) {
  const end = performance.now() + milliseconds
  while (performance.now() < end) { const value = await check(); if (value) return value; await pause(25) }
  throw new Error('Acceptance condition did not arrive before its deadline')
}

export async function runAcceptance(options) {
  requireTrue(options.execute === true, 'Acceptance requires explicit execution')
  requireTrue(process.platform === 'darwin' && process.arch === 'arm64', 'Acceptance requires Apple Silicon macOS')
  await mkdir(dirname(options.directory), { recursive: true }); await mkdir(options.directory, { mode: 0o700 })
  const directory = await realpath(options.directory), stagedPackage = join(directory, 'original-package'), moved = join(directory, 'moved package'), root = join(directory, 'workspace'), privateDir = join(directory, 'private'), ownerHome = join(directory, 'clean-home')
  await mkdir(root); await mkdir(privateDir, { mode: 0o700 }); await mkdir(ownerHome)
  const receipt = { schema: 1, kind: 'native-companion-package-acceptance', startedAt: new Date().toISOString(), timingScope: 'Functional acceptance, not an isolated performance measurement', checks: [], limitations: ['Native HTTPS API/PTY/Next proof only; no browser UI or browser trust proof', 'Uses existing pinned dependencies, not a fresh install', 'Package is unsigned and not notarized'] }
  const receiptPath = join(directory, 'receipt.json')
  const check = (name, details = {}) => { receipt.checks.push({ name, ok: true, ...details }) }
  let active
  const ca = await readFile(options['tls-ca'], 'utf8'), origin = 'https://kaush4l.github.io'
  const tls = { ca, rejectUnauthorized: true }
  const cleanEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: ownerHome, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'en_US.UTF-8' }
  async function start(capabilities) {
    const pairingFile = join(privateDir, `${crypto.randomUUID()}.json`)
    const argv = [join(moved, 'askk-companion'), '--root', root, '--allow-origin', origin, '--capabilities', capabilities.join(','), '--tls-cert', options['tls-cert'], '--tls-key', options['tls-key'], '--pairing-file', pairingFile, '--port', String(options.port)]
    const child = Bun.spawn(argv, { env: cleanEnv, cwd: ownerHome, stdout: 'pipe', stderr: 'pipe' })
    const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text()
    let pairing
    try { pairing = await until(async () => { if (child.exitCode !== null) throw new Error(`Launcher exited before pairing: ${await stderr}`); try { return JSON.parse(await readFile(pairingFile, 'utf8')) } catch { return null } }) }
    catch (error) { child.kill('SIGTERM'); await bounded(child.exited, 5000, 'Failed startup shutdown').catch(() => child.kill('SIGKILL')); throw error }
    requireTrue((await stat(pairingFile)).mode % 512 === 0o600, 'Pairing file mode was not0600')
    const session = { child, pairing, pairingFile, stdout, stderr, capabilities }
    active = session
    return session
  }
  async function request(session, path, body = {}, extra = {}) {
    return fetch(`${session.pairing.url}${path}`, { method: 'POST', headers: { origin, authorization: `Bearer ${session.pairing.token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body), tls, signal: AbortSignal.timeout(240000) })
  }
  async function stop(session) {
    session.child.kill('SIGTERM')
    const code = await bounded(session.child.exited, 10000, 'Companion shutdown').catch(error => { session.child.kill('SIGKILL'); throw error })
    const output = `${await session.stdout}${await session.stderr}`
    requireTrue(code === 0, `Companion shutdown exit was ${code}`)
    requireTrue(!output.includes(session.pairing.token), 'Launcher exposed its token to output')
    requireTrue(!await lstat(session.pairingFile).catch(() => null), 'Pairing file survived graceful shutdown')
    active = null
  }
  async function command(session, text, { onEvent = () => {}, id = crypto.randomUUID(), timeout = 180 } = {}) {
    const started = performance.now(), response = await request(session, '/jobs/run', { id, program: '/bin/sh', args: ['-c', text], cwd: '.', timeout })
    requireTrue(response.ok, `Command admission HTTP${response.status}`)
    const events = []; let buffered = '', stdout = '', stderr = '', exit
    for await (const bytes of response.body.pipeThrough(new TextDecoderStream())) {
      buffered += bytes; let newline
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1); if (!line) continue
        const event = JSON.parse(line); requireTrue(event.jobId === id, 'Mismatched command identity'); events.push(event); onEvent(event)
        if (event.type === 'output') { if (event.stream === 'stdout') stdout += event.data; else stderr += event.data }
        if (event.type === 'exit') exit = event
      }
    }
    requireTrue(exit && Number.isInteger(exit.code), 'Stream had no actual exit receipt')
    return { id, stdout, stderr, exit, events, milliseconds: performance.now() - started }
  }
  try {
    const built = await buildPackage({ repository, bun: process.execPath, output: stagedPackage })
    await rename(stagedPackage, moved); await verifyPackage(moved)
    receipt.manifest = built.manifest
    check('relocated package manifest verified', { files: built.manifest.files.length, bytes: built.manifest.files.reduce((total, file) => total + file.size, 0) })
    const helpChild = Bun.spawn([join(moved, 'askk-companion'), '--help'], { env: cleanEnv, cwd: ownerHome, stdout: 'pipe', stderr: 'pipe' })
    const helpOutput = await new Response(helpChild.stdout).text()
    requireTrue(await helpChild.exited === 0 && helpOutput.includes('All grants are explicit'), 'Clean-PATH help failed')
    check('clean-PATH launcher help')
    const relay = await start(['model-relay', 'network-relay'])
    const relayHealth = await (await request(relay, '/whoami')).json()
    requireTrue(JSON.stringify(relayHealth.capabilities) === JSON.stringify(relay.capabilities), 'Relay gained unintended capabilities')
    for (const [path, body] of [['/workspace/list', {}], ['/jobs/run', { program: '/bin/echo', args: ['must-not-run'] }], ['/terminals/open', {}]]) requireTrue((await request(relay, path, body)).status === 403, `Relay allowed ${path}`)
    requireTrue((await request(relay, '/whoami', {}, { origin: 'https://unapproved.example' })).status === 403, 'Origin guard failed')
    check('TLS relay-only authority and origin rejection', { capabilities: relayHealth.capabilities })
    await stop(relay); check('relay shutdown and pairing cleanup')
    const native = await start(['fs', 'exec', 'terminal'])
    const text = 'Packaged Bun saved 🦊\n'
    const writtenResponse = await request(native, '/workspace/write', { path: 'native-proof.txt', content: text, expectedRevision: 0 })
    const written = await writtenResponse.json(), saved = await (await request(native, '/workspace/read', { path: 'native-proof.txt' })).json()
    requireTrue(writtenResponse.ok && saved.content === text && written.rev === saved.rev, 'Native file acknowledgement did not match its read')
    requireTrue((await request(native, '/workspace/write', { path: 'native-proof.txt', content: 'must conflict', expectedRevision: 0 })).status === 409, 'Native stale-write conflict was lost')
    check('native Unicode file acknowledgement and stale CAS refusal', { revision: written.rev })
    const identity = await command(native, `command -v bun; bun -p 'JSON.stringify({execPath:process.execPath,version:Bun.version,node:process.version})'; if command -v node >/dev/null || command -v npm >/dev/null; then exit 9; fi`)
    requireTrue(identity.exit.code === 0, 'Clean-PATH identity command failed or found host Node/npm')
    const [shim, runtimeJSON] = identity.stdout.trim().split('\n'), runtime = JSON.parse(runtimeJSON)
    requireTrue(shim === join(moved, 'bin/bun') && runtime.execPath === join(moved, 'runtime/bun') && runtime.version === built.manifest.runtime.version, 'Command used another Bun runtime')
    check('job uses packaged Bun with no Node/npm on PATH', { runtimeVersion: runtime.version, code: identity.exit.code })
    const falseSuccess = await command(native, 'printf "visible output\\n"; exit 7')
    requireTrue(falseSuccess.exit.code === 7 && falseSuccess.stdout.includes('visible output'), 'Nonzero exit was lost')
    check('streamed actual nonzero exit', { code: falseSuccess.exit.code })
    const terminal = await (await request(native, '/terminals/open', { cols: 80, rows: 24 })).json()
    const socketURL = new URL(`${native.pairing.url}/terminals/socket`); socketURL.protocol = 'wss:'; socketURL.searchParams.set('ticket', terminal.ticket)
    const socket = new WebSocket(socketURL, { headers: { origin }, tls })
    let terminalOutput = ''
    socket.onmessage = ({ data }) => { const event = JSON.parse(String(data)); if (event.type === 'output') terminalOutput += event.data }
    await bounded(new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('TLS PTY connection failed')) }), 10000, 'PTY opening')
    socket.send(JSON.stringify({ type: 'resize', cols: 103, rows: 37 }))
    socket.send(JSON.stringify({ type: 'input', data: `command -v bun > pty-path.txt\nbun -p 'JSON.stringify({execPath:process.execPath,version:Bun.version})' > pty-runtime.txt\nstty size > pty-size.txt\nprintf 'PTY proof ready\\n'\n` }))
    await until(async () => terminalOutput.includes('PTY proof ready') && await readFile(join(root, 'pty-size.txt'), 'utf8').catch(() => '') === '37 103\n', 15000)
    requireTrue((await readFile(join(root, 'pty-path.txt'), 'utf8')).trim() === join(moved, 'bin/bun'), 'PTY selected another Bun')
    requireTrue(JSON.parse(await readFile(join(root, 'pty-runtime.txt'), 'utf8')).execPath === join(moved, 'runtime/bun'), 'PTY child used another runtime')
    await request(native, '/terminals/close', { id: terminal.id }); await until(() => socket.readyState === WebSocket.CLOSED)
    check('PTY input resize and packaged runtime', { rows: 37, cols: 103 })
    let startedResolve
    const admitted = new Promise(resolve => { startedResolve = resolve }), cancellationId = crypto.randomUUID()
    const pending = command(native, '(sleep 2; echo leaked > cancellation-leak.txt) & printf "owned-job-started\\n"; wait', { id: cancellationId, onEvent: event => { if (event.type === 'output' && event.data.includes('owned-job-started')) startedResolve() } })
    await bounded(admitted, 5000, 'Cancellation job admission')
    await request(native, '/jobs/cancel', { id: cancellationId })
    const cancelled = await pending
    await pause(2100)
    requireTrue(cancelled.exit.cancelled === true && !await lstat(join(root, 'cancellation-leak.txt')).catch(() => null), 'Cancellation failed to stop owned process group')
    check('process group cancellation has actual exit', { exit: cancelled.exit })
    const packages = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
    const fixture = nextFixture(packages.dependencies)
    for (const [path, content] of Object.entries(fixture)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content) }
    await symlink(await realpath(join(repository, 'node_modules')), join(root, 'node_modules'), 'dir')
    const next = await command(native, 'NEXT_TELEMETRY_DISABLED=1 bun --bun run build', { timeout: 180 })
    receipt.next = next
    requireTrue(next.exit.code === 0 && !next.exit.cancelled, 'Packaged Next export failed')
    const html = await readFile(join(root, 'out/index.html'), 'utf8')
    requireTrue(html.includes('Packaged companion proof'), 'Exported page missing expected content')
    check('actual Next App Router webpack static export', { milliseconds: next.milliseconds, outputSHA256: createHash('sha256').update(html).digest('hex'), next: packages.dependencies.next })
    await stop(native); check('native shutdown and pairing cleanup')
    receipt.ok = true
  } catch (error) { receipt.ok = false; receipt.error = error.message; throw error }
  finally {
    if (active) await stop(active).catch(error => { receipt.cleanupError = error.message; receipt.ok = false })
    receipt.finishedAt = new Date().toISOString()
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 }); await chmod(receiptPath, 0o600)
  }
  return { receiptPath, ok: receipt.ok, checks: receipt.checks.length, receiptSHA256: await sha256(receiptPath) }
}

if (import.meta.main) {
  try {
    const options = parseAcceptanceOptions(process.argv.slice(2))
    if (options.help) console.log(acceptanceHelp)
    else { const result = await runAcceptance(options); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1 }
  }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
