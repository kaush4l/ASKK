import { isAbsolute, join } from 'node:path'
import { normalizeModelEndpoints } from '../../host/companion.js'

export const capabilityNames = Object.freeze(['fs', 'exec', 'terminal', 'fetch', 'model-relay', 'network-relay'])
const text = value => typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
const absolute = (value, label) => { if (!text(value) || !isAbsolute(value)) throw new Error(`${label} must be an absolute path without control characters`); return value }
const known = new Set(['root', 'allow-origin', 'capabilities', 'model-endpoint', 'tls-cert', 'tls-key', 'pairing-file', 'port'])

export const help = `ASKK Local Bun companion (Apple Silicon macOS)
Usage: ./askk-companion --root /project --allow-origin https://kaush4l.github.io \\
  --capabilities fs,exec,terminal,model-relay,network-relay \\
  --tls-cert /private/cert.pem --tls-key /private/key.pem \\
  --pairing-file /private/askk-pairing.json [--port 7717] [--check]

All grants are explicit. Repeat --allow-origin for additional exact page origins.
Model relay also needs --model-endpoint http://127.0.0.1:8873/v1 (repeatable).
Only GET /models and POST /chat/completions or /messages below that base are allowed.
Without an endpoint scope, model requests fail closed; other grants still work.
--check validates package hashes and path configuration without starting a server;
        certificate validity/key matching and browser trust are separate startup gates.
--help  prints this message without loading credentials or starting a server.
The pairing file must not already exist, and must be outside the project/package.
Ctrl+C stops owned jobs and terminals, closes the server and removes that file.
No certificate installation, background service, automatic restart or Node install.
`

export function parseLaunchOptions(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true }
  const args = {}; let check = false
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--check') { if (check) throw new Error('Duplicate --check'); check = true; continue }
    const name = flag.startsWith('--') ? flag.slice(2) : ''
    if (!known.has(name)) throw new Error(`Unknown option: ${flag}`)
    const value = argv[++i]
    if (!text(value) || value.startsWith('--')) throw new Error(`Missing value for --${name}`)
    if (name === 'allow-origin' || name === 'model-endpoint') (args[name] ??= []).push(value)
    else { if (Object.hasOwn(args, name)) throw new Error(`Duplicate --${name}`); args[name] = value }
  }
  const root = absolute(args.root, '--root'), cert = absolute(args['tls-cert'], '--tls-cert'), key = absolute(args['tls-key'], '--tls-key'), pairingFile = absolute(args['pairing-file'], '--pairing-file')
  if (!args['allow-origin']?.length) throw new Error('At least one explicit --allow-origin is required')
  const origins = [...new Set(args['allow-origin'].map(value => {
    let url; try { url = new URL(value) } catch { throw new Error('Allowed page origins must be valid URLs') }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || value !== url.origin || url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Allow an exact HTTPS page origin (or HTTP loopback origin), without path or credentials')
    return url.origin
  }))]
  const capabilities = args.capabilities?.split(',')
  if (!capabilities?.length || new Set(capabilities).size !== capabilities.length || capabilities.some(name => !capabilityNames.includes(name))) throw new Error(`Explicit --capabilities must list unique names from: ${capabilityNames.join(',')}`)
  const port = args.port ?? '7717'
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) throw new Error('--port must be an integer from 1 to 65535')
  const modelEndpoints = normalizeModelEndpoints(args['model-endpoint'])
  return { root, origins, capabilities, modelEndpoints, cert, key, pairingFile, port: Number(port), check }
}

/** Explicitly omit inherited provider tokens, pairing tokens and runtime preload flags. */
export function childEnvironment(packageRoot, env = process.env) {
  if (!text(packageRoot) || !isAbsolute(packageRoot) || packageRoot.includes(':')) throw new Error('Package directory must be absolute and cannot contain PATH separators or control characters')
  const result = { PATH: `${join(packageRoot, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin` }
  for (const name of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']) if (typeof env[name] === 'string') result[name] = env[name]
  return result
}
