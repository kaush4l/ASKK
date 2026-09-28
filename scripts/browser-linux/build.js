#!/usr/bin/env bun
/** Build only in the dedicated Docker context. All large intermediate output stays in .cache. */
import { mkdir, readFile, writeFile, readdir, appendFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { patchRuntime } from './patch-runtime.js'
import { errnoMarker, errnoTranslation } from './patch-errno.js'
import { templateMetadata } from './template-metadata.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cache = path.join(root, '.cache/browser-linux')
const source = path.join(cache, 'container2wasm')
const output = path.join(cache, 'artifact')
const context = process.env.ASKK_DOCKER_CONTEXT ?? 'colima-askk-browser-build'
const commit = '6ed3d98882a2b22eafc1334f574c364a5b2b8c47'
const env = { ...process.env, DOCKER_CONTEXT: context }
const buildLog = path.join(cache, 'build-evidence.log')
async function run(command, args, cwd = root) {
  console.log(`> ${command} ${args.join(' ')}`)
  const child = Bun.spawn([command, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const drain = async (stream, destination) => { for await (const bytes of stream) { destination.write(bytes); await appendFile(buildLog, bytes) } }
  const [code] = await Promise.all([child.exited, drain(child.stdout, process.stdout), drain(child.stderr, process.stderr)])
  if (code !== 0) throw new Error(`${command} exited ${code}`)
}
await mkdir(cache, { recursive: true })
await writeFile(buildLog, '')
if (!(await Bun.file(path.join(source, 'Dockerfile')).exists())) await run('git', ['clone', '--depth', '1', '--branch', 'v0.8.4', 'https://github.com/container2wasm/container2wasm.git', source])
const revision = await new Response(Bun.spawn(['git', '-C', source, 'rev-parse', 'HEAD'], { stdout: 'pipe' }).stdout).text()
if (revision.trim() !== commit) throw new Error('Unexpected container2wasm source revision')
await run('go', ['build', '-o', path.join(cache, 'c2w'), './cmd/c2w'], source)
let dockerfile = await readFile(path.join(source, 'Dockerfile'), 'utf8')
const before = '-sEXPORTED_RUNTIME_METHODS=addFunction,removeFunction,TTY,FS'
if (!dockerfile.includes(before)) throw new Error('Upstream filesystem export patch no longer applies')
dockerfile = dockerfile.replaceAll(before, '-lidbfs.js -sEXPORTED_RUNTIME_METHODS=addFunction,removeFunction,TTY,FS,IDBFS,addRunDependency,removeRunDependency')
dockerfile = dockerfile.replaceAll('https://github.com/ktock/container2wasm', 'https://github.com/container2wasm/container2wasm')
dockerfile = dockerfile.replaceAll('https://ftp.gnu.org/gnu/grub/grub-2.06.tar.gz', 'https://mirrors.kernel.org/gnu/grub/grub-2.06.tar.gz')
// Go 1.26's compiler crashes under this builder's x86 emulation. The project requires Go 1.25.
dockerfile = dockerfile.replace('FROM golang:1.26-bookworm AS golang-base', 'FROM golang:1.25-bookworm AS golang-base\nENV GODEBUG=asyncpreemptoff=1')
dockerfile = dockerfile.replace('FROM gcc:14 AS qemu-native-dev', 'FROM gcc:14-bookworm AS qemu-native-dev')
const asyncFfi = process.env.ASKK_ASYNC_FFI === '1'
if (asyncFfi) {
  const armFlags = '-sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=emmalloc -sEXPORT_ES6=1 $XTERM_PTY_CFLAGS'
  if (!dockerfile.includes(armFlags)) throw new Error('Pinned ARM QEMU flags changed')
  dockerfile = dockerfile.replace(armFlags, '-sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=emmalloc -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js $XTERM_PTY_CFLAGS')
}
const armStage = 'FROM qemu-emscripten-dev AS qemu-emscripten-dev-aarch64\nARG LOAD_MODE'
if (!dockerfile.includes(armStage)) throw new Error('Pinned QEMU ARM stage changed')
dockerfile = dockerfile.replace(armStage, `${armStage}\nRUN python3 - <<'PY'\nfrom pathlib import Path\nimport base64\np = Path('/qemu/hw/9pfs/9p-util.h')\ns = p.read_text()\nold = ${JSON.stringify(errnoMarker)}\nassert s.count(old) == 1, 'Pinned 9p errno boundary changed'\np.write_text(s.replace(old, base64.b64decode('${Buffer.from(errnoTranslation).toString('base64')}').decode()))\nPY`)
// Report the actual shared-filesystem error instead of waiting silently during boot.
const initStage = 'FROM golang-base AS init-aarch64-dev\nCOPY --link --from=assets / /work\nWORKDIR /work'
if (!dockerfile.includes(initStage)) throw new Error('Pinned guest init stage changed')
dockerfile = dockerfile.replace(initStage, `${initStage}\nRUN sed -i 's|//return fmt.Errorf("failed mounting(pack) %q: %w", packFSTag, err)|log.Printf("failed mounting(pack) %q: %v", packFSTag, err)|' cmd/init/main.go && sed -i 's|} else if !errors.Is(err, os.ErrNotExist) {|} else if errors.Is(err, os.ErrNotExist) { log.Printf("waiting for info file: %v", err) } else {|' cmd/init/main.go && sed -i 's@if cfg.Debug || cfg.DebugInit {@cfg.Debug = true; if cfg.Debug || cfg.DebugInit {@' cmd/init/main.go`)
// Give packing its own cache identity after a host-disk failure invalidated old data layers.
dockerfile = dockerfile.replaceAll('RUN if test "${LOAD_MODE}" = "single" ; then', 'RUN : askk-verified-pack-v1 && if test "${LOAD_MODE}" = "single" ; then')
const patched = path.join(cache, 'Dockerfile.idbfs')
await writeFile(patched, dockerfile)
await run('docker', ['build', '--platform', 'linux/arm64', '-t', 'askk-browser-node:24', '-f', path.join(root, 'guest/Dockerfile'), path.join(root, 'guest')])
await run('docker', ['run', '--rm', '--entrypoint', 'node', 'askk-browser-node:24', '-e', 'const p=require("/opt/harness/node_modules/node-pty");const t=p.spawn("/bin/sh",["-c","test -t 0 && stty size"],{cols:91,rows:31});let s="";t.onData(x=>s+=x);t.onExit(x=>{if(x.exitCode||!s.includes("31 91"))process.exit(1);console.log("native PTY verified",s.trim(),process.version)})'])
await run('docker', ['run', '--rm', '--mount', `type=bind,source=${path.join(root, 'guest/native-probe.js')},target=/tmp/native-probe.js,readonly`, '--entrypoint', 'node', 'askk-browser-node:24', '/tmp/native-probe.js'])
await mkdir(output, { recursive: true })
const recovery = process.env.ASKK_RECOVER_PACK_CACHE === '1' ? ['--extra-flag=--no-cache-filter=oci-image-src,bundle-dev,rootfs-aarch64-dev,qemu-config-dev-aarch64'] : []
await run(path.join(cache, 'c2w'), ['--to-js', '--target-arch', 'aarch64', '--assets', source, '--dockerfile', patched, '--build-arg', 'VM_MEMORY_SIZE_MB=1536', '--build-arg', 'QEMU_MIGRATION=false', ...recovery, 'askk-browser-node:24', `${output}/`])
const runtimePatch = patchRuntime(await readFile(path.join(output, 'out.js'), 'utf8'))
await writeFile(path.join(output, 'out.js'), runtimePatch.code)
// Compile pinned QEMU configuration locally; do not trust an old Docker COPY output layer.
const argsTemplate = await readFile(path.join(source, 'config/qemu/args-aarch64.json.template'), 'utf8')
const substitutions = { MIGRATION: '', MEMORY_SIZE: '1536', CORE_NUMS: '1', LOGLEVEL: '0', WASI0_PATH: '/', WASI1_PATH: '/pack' }
const qemuArgs = JSON.parse(argsTemplate.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
  if (!(key in substitutions)) throw new Error(`Unknown pinned QEMU configuration value ${key}`)
  return substitutions[key]
}))
// Leave headroom for 1536 MiB guest RAM inside the upstream 2300 MiB Wasm heap.
const accelerationIndex = qemuArgs.indexOf('-accel') + 1
if (!accelerationIndex || qemuArgs[accelerationIndex] !== 'tcg,tb-size=500,thread=multi') throw new Error('Pinned QEMU acceleration configuration changed')
qemuArgs[accelerationIndex] = 'tcg,tb-size=128,thread=multi'
if (!qemuArgs.includes('1536M') || !qemuArgs.some((arg) => arg.includes('/pack/rootfs.bin'))) throw new Error('Packed guest arguments are missing or have the wrong memory allocation')
await writeFile(path.join(output, 'arg-module.js'), `Module['arguments'] = ${JSON.stringify(qemuArgs, null, 2)};\n`)
await run('bun', [path.join(root, 'scripts/browser-linux/prepare-network.js')])
for (const name of ['network.js', 'network-worker.js', 'network.wasm.gz', 'pty.js', 'container2wasm.LICENSE', 'xterm-pty.LICENSE', 'browser_wasi_shim.LICENSE-MIT', 'browser_wasi_shim.LICENSE-APACHE']) await copyFile(path.join(root, 'public/browser-linux/vendor', name), path.join(output, name))
await copyFile(path.join(root, 'guest/supervisor.js'), path.join(output, 'supervisor.js'))
const files = []
for (const name of (await readdir(output)).sort()) {
  if (name === 'manifest.json') continue
  const bytes = await readFile(path.join(output, name))
  if (!bytes.length) throw new Error(`Empty runtime asset: ${name}`)
  files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
const imageHash = createHash('sha256').update(JSON.stringify(files)).digest('hex')
const log = await readFile(buildLog, 'utf8')
const builderImages = [...new Set([...log.matchAll(/(?:FROM|resolve)\s+(\S+@sha256:[a-f0-9]{64})/g)].map((match) => match[1]))].sort()
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sourceInfo = { container2wasm: commit, qemu: '8604ed49a3cde392890b014a8d5a959c8a2fe72a',
  guestSupervisorSha256: sha(await readFile(path.join(root, 'guest/supervisor.js'))), guestEntrypoint: '/harness-control/supervisor.js (verified 9p asset)', guestDockerfileSha256: sha(await readFile(path.join(root, 'guest/Dockerfile'))),
  upstreamDockerfileSha256: sha(await readFile(path.join(source, 'Dockerfile'))), patchedDockerfileSha256: sha(dockerfile), buildScriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  qemuArgsTemplateSha256: sha(argsTemplate), qemuArgsSubstitutions: substitutions, translationCacheMiB: 128, asyncFfi,
  generatedRuntimePatch: runtimePatch.provenance, runtimePatchScriptSha256: sha(await readFile(path.join(root, 'scripts/browser-linux/patch-runtime.js'))),
  errnoTranslation: { source: 'Linux v6.1 UAPI asm-generic errno', mapSha256: sha(await readFile(path.join(root, 'scripts/browser-linux/linux-errno.json'))), patchSha256: sha(await readFile(path.join(root, 'scripts/browser-linux/patch-errno.js'))) },
  patches: ['IDBFS link and exports', 'maintained upstream source URL', 'GNU kernel.org mirror', 'Go 1.25 Bookworm with async preemption disabled', 'GCC 14 Bookworm', 'guest shared-filesystem diagnostic errors', 'verified pack cache identity v1'],
  builderImages, buildLogSha256: sha(log), emscripten: '4.0.10', nodePty: '1.1.0', next: '16.3.6', react: '19.3.0', preparedTemplate: await templateMetadata(root) }
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, id: `c2w-node24-${imageHash.slice(0, 16)}`, builtAt: new Date().toISOString(), source: sourceInfo, architecture: 'aarch64', guestMemoryMiB: 1536, wasmMemoryMiB: 2300, filesystem: '9p-idbfs', files, verification: { nativePty: true, nativePreparedTemplate: true, nativeNextStaticExport: true, browser: false } }, null, 2))
console.log(`Built runtime: ${output}`)
