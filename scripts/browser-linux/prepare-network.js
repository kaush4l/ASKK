#!/usr/bin/env bun
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cache = path.join(root, '.cache/browser-linux')
const tooling = path.join(cache, 'tooling')
const source = path.join(cache, 'container2wasm/extras/runcontainerjs/src/web')
const vendor = path.join(root, 'public/browser-linux/vendor')
await mkdir(path.join(tooling, 'src'), { recursive: true }); await mkdir(vendor, { recursive: true })
await writeFile(path.join(tooling, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'xterm-pty': '0.10.1', '@bjorn3/browser_wasi_shim': '0.2.17' } }))
const install = Bun.spawn(['bun', 'install'], { cwd: tooling, stdout: 'inherit', stderr: 'inherit' })
if (await install.exited) throw new Error('Runtime transport dependency installation failed')
for (const name of ['runcontainer.js', 'stack-worker.js', 'worker-util.js', 'wasi-util.js']) await copyFile(path.join(source, name), path.join(tooling, 'src', name))
const runcontainer = path.join(tooling, 'src/runcontainer.js')
let transport = await readFile(runcontainer, 'utf8')
const fetchExpression = 'fetch(connObj.address, connObj.request)'
if (transport.split(fetchExpression).length !== 3) throw new Error('Upstream guest fetch hook changed')
transport = `let runtimeFetch = (...args) => globalThis.fetch(...args);\nexport function setBrowserFetch(fetcher) { runtimeFetch = fetcher ?? ((...args) => globalThis.fetch(...args)); }\n${transport}`
await writeFile(runcontainer, transport.replaceAll(fetchExpression, 'runtimeFetch(connObj.address, connObj.request)').replace("console.error('Error loading modules:', error);", "throw error;"))
// Embedded images use c2w-net-proxy, not the optional external-image mounter.
const worker = path.join(tooling, 'src/stack-worker.js')
const workerSource = await readFile(worker, 'utf8')
if (!workerSource.includes(", '--image-addr='+info.imageAddr")) throw new Error('Upstream proxy arguments changed')
await writeFile(worker, workerSource.replace(", '--image-addr='+info.imageAddr", ''))
await writeFile(path.join(tooling, 'src/pty.js'), "import pty from 'xterm-pty'; export const {openpty}=pty;\n")
for (const [entry, name, format] of [['runcontainer.js', 'network.js', 'esm'], ['stack-worker.js', 'network-worker.js', 'iife'], ['pty.js', 'pty.js', 'esm']]) {
  const result = await Bun.build({ entrypoints: [path.join(tooling, 'src', entry)], target: 'browser', format, minify: true })
  if (!result.success) throw new Error(result.logs.join('\n'))
  await writeFile(path.join(vendor, name), await result.outputs[0].text())
}
const proxy = path.join(cache, 'network.wasm')
const build = Bun.spawn(['go', 'build', '-o', proxy, '.'], { cwd: path.join(cache, 'container2wasm/extras/c2w-net-proxy'), env: { ...process.env, GOOS: 'wasip1', GOARCH: 'wasm' }, stdout: 'inherit', stderr: 'inherit' })
if (await build.exited) throw new Error('Browser network stack build failed')
await writeFile(path.join(vendor, 'network.wasm.gz'), Bun.gzipSync(await readFile(proxy)))
await copyFile(path.join(cache, 'container2wasm/LICENSE'), path.join(vendor, 'container2wasm.LICENSE'))
for (const kind of ['MIT', 'APACHE']) await copyFile(path.join(tooling, 'node_modules/@bjorn3/browser_wasi_shim', `LICENSE-${kind}`), path.join(vendor, `browser_wasi_shim.LICENSE-${kind}`))
const license = await fetch('https://raw.githubusercontent.com/mame/xterm-pty/v0.10.1/LICENSE.txt')
if (!license.ok) throw new Error('Could not retrieve the pinned xterm-pty license')
await writeFile(path.join(vendor, 'xterm-pty.LICENSE'), await license.text())
console.log(`Prepared browser network and console transports in ${vendor}`)
