#!/usr/bin/env bun
/** Rebuild the Linux dependency payload without compiling or changing QEMU JS/Wasm. */
import { mkdir, readFile, writeFile, appendFile, rename, statfs } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { templateMetadata } from './template-metadata.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cache = path.join(root, '.cache/browser-linux'), artifact = path.join(cache, 'artifact')
const context = process.env.ASKK_DOCKER_CONTEXT ?? 'colima-askk-browser-build'
const env = { ...process.env, DOCKER_CONTEXT: context }
const logPath = path.join(cache, 'repack-evidence.log')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const parent = JSON.parse(await readFile(path.join(artifact, 'manifest.json'), 'utf8'))
const image = 'askk-browser-node:template24'
const templateBefore = await templateMetadata(root)
const guestDockerfileSha256 = sha(await readFile(path.join(root, 'guest/Dockerfile')))
const unchanged = ['out.js', 'qemu-system-aarch64.wasm']
for (const name of unchanged) {
  if (sha(await readFile(path.join(artifact, name))) !== parent.files.find((entry) => entry.name === name)?.sha256) throw new Error(`Original compiled asset changed: ${name}`)
}
await writeFile(path.join(cache, 'repack-parent.json'), JSON.stringify(parent, null, 2))
await writeFile(logPath, '')
async function run(program, args) {
  console.log(`> ${program} ${args.join(' ')}`)
  const child = Bun.spawn([program, ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
  let stdout = ''
  const drain = async (stream, output, capture) => { for await (const bytes of stream) { output.write(bytes); await appendFile(logPath, bytes); if (capture) stdout += Buffer.from(bytes).toString() } }
  const [code] = await Promise.all([child.exited, drain(child.stdout, process.stdout, true), drain(child.stderr, process.stderr, false)])
  if (code !== 0) throw new Error(`${program} exited ${code}`)
  return stdout
}
await run('docker', ['build', '--platform', 'linux/arm64', '-t', image, '-f', path.join(root, 'guest/Dockerfile'), path.join(root, 'guest')])
await run('docker', ['run', '--rm', '--mount', `type=bind,source=${path.join(root, 'guest/native-probe.js')},target=/tmp/native-probe.js,readonly`, '--entrypoint', 'node', image, '/tmp/native-probe.js'])
await run('docker', ['run', '--rm', '--entrypoint', 'node', image, '-e', 'const p=require("/opt/harness/node_modules/node-pty");const t=p.spawn("/bin/sh",["-c","test -t 0 && stty size"],{cols:91,rows:31});let s="";t.onData(x=>s+=x);t.onExit(x=>{if(x.exitCode||!s.includes("31 91"))process.exit(1);console.log("native PTY verified",s.trim(),process.version)})'])
const sizes = await run('docker', ['run', '--rm', '--entrypoint', '/bin/sh', image, '-c', 'du -sk /opt/harness/template/node_modules /root/.npm; du -skx --exclude=/proc --exclude=/sys --exclude=/dev /'])
if (process.argv.includes('--native-only')) { console.log('Native proof complete; repacking was not requested.'); process.exit(0) }
const rootLine = sizes.split('\n').find((line) => /\s\/$/.test(line))
if (!rootLine) throw new Error('Could not determine guest tree size')
const estimatedBytes = Number(rootLine.trim().split(/\s/)[0]) * 1024 + 80000000
const free = await statfs(cache)
if (free.bavail * free.bsize < estimatedBytes * 4 + 1024 * 1024 * 1024) throw new Error(`Insufficient disk headroom for unpacked rootfs, ISO, packed data and export (${estimatedBytes} estimated bytes each)`)
const base = await readFile(path.join(cache, 'Dockerfile.idbfs'), 'utf8')
if (sha(base) !== parent.source.patchedDockerfileSha256) throw new Error('Pinned parent build Dockerfile changed')
const sdk = parent.source.builderImages.find((entry) => entry.startsWith('docker.io/emscripten/emsdk:4.0.10@sha256:'))
if (!sdk) throw new Error('The parent image does not record the exact Emscripten builder digest')
// Reuse the exact verified kernel and firmware from the parent image. A rootfs
// profile change does not need a kernel rebuild or a new QEMU repository clone.
const loadSource = await readFile(path.join(artifact, 'load.js'), 'utf8')
if (sha(loadSource) !== parent.files.find(file => file.name === 'load.js')?.sha256) throw new Error('Parent data loader integrity mismatch')
const layoutMatch = loadSource.match(/loadPackage\((\{"files":.+\})\);/)
if (!layoutMatch) throw new Error('Unknown parent data loader layout')
const layout = JSON.parse(layoutMatch[1])
const publishedRoot = path.join(root, 'public/browser-linux/generated')
const publishedParent = JSON.parse(await readFile(path.join(publishedRoot, parent.id, 'manifest.json'), 'utf8'))
const parentData = publishedParent.files.find(file => file.name === 'qemu-system-aarch64.data')
if (parentData?.sha256 !== parent.files.find(file => file.name === parentData.name)?.sha256) throw new Error('Published parent data identity mismatch')
const bootDirectory = path.join(cache, 'repack-boot')
await mkdir(bootDirectory, { recursive: true })
const bootFiles = []
for (const name of ['bzImage', 'edk2-aarch64-code.fd', 'efi-virtio.rom']) {
  const region = layout.files.find(file => file.filename === `/pack/${name}`)
  if (!region || !Number.isSafeInteger(region.start) || !Number.isSafeInteger(region.end) || region.start < 0 || region.end <= region.start || region.end > parentData.bytes) throw new Error(`Invalid boot asset region: ${name}`)
  const pieces = []; let offset = 0
  for (const part of parentData.parts ?? [parentData]) {
    const end = offset + part.bytes
    if (end > region.start && offset < region.end) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(part.name)) throw new Error('Unsafe parent asset path')
      const bytes = await readFile(path.join(publishedRoot, parent.id, part.name))
      if (bytes.length !== part.bytes || sha(bytes) !== part.sha256) throw new Error(`Parent boot data integrity mismatch: ${part.name}`)
      pieces.push(bytes.subarray(Math.max(0, region.start - offset), Math.min(bytes.length, region.end - offset)))
    }
    offset = end
  }
  const bytes = Buffer.concat(pieces)
  if (bytes.length !== region.end - region.start) throw new Error(`Incomplete parent boot asset: ${name}`)
  await writeFile(path.join(bootDirectory, name), bytes)
  bootFiles.push({ name, bytes: bytes.length, sha256: sha(bytes), parentRegion: region })
}
const dockerfile = `${base}\nFROM ${sdk} AS askk-rootfs-pack\nWORKDIR /out\nRUN mkdir /pack\nRUN --mount=from=rootfs-aarch64-dev,source=/out/rootfs.bin,target=/pack/rootfs.bin,ro --mount=from=askkboot,source=/bzImage,target=/pack/bzImage,ro --mount=from=askkboot,source=/edk2-aarch64-code.fd,target=/pack/edk2-aarch64-code.fd,ro --mount=from=askkboot,source=/efi-virtio.rom,target=/pack/efi-virtio.rom,ro /emsdk/upstream/emscripten/tools/file_packager.py qemu-system-aarch64.data --preload /pack > load.js\nFROM scratch AS askk-rootfs-export\nCOPY --from=askk-rootfs-pack /out/ /\n`
const dockerfilePath = path.join(cache, 'Dockerfile.repack')
await writeFile(dockerfilePath, dockerfile)
const output = path.join(cache, 'repacked')
await mkdir(output, { recursive: true })
await run(path.join(cache, 'c2w'), ['--target-stage', 'askk-rootfs-export', '--target-arch', 'aarch64', '--assets', path.join(cache, 'container2wasm'), '--dockerfile', dockerfilePath, '--extra-flag', `--build-context=askkboot=${bootDirectory}`, '--build-arg', 'OPTIMIZATION_MODE=wizer', '--build-arg', 'NO_BINFMT=true', '--build-arg', 'VM_MEMORY_SIZE_MB=1536', '--build-arg', 'QEMU_MIGRATION=false', image, `${output}/`])
const replacements = []
for (const name of ['qemu-system-aarch64.data', 'load.js']) {
  const bytes = await readFile(path.join(output, name))
  if (!bytes.length) throw new Error(`Empty repacked asset: ${name}`)
  replacements.push({ name, bytes: bytes.length, sha256: sha(bytes) })
}
const files = parent.files.filter((file) => !replacements.some((entry) => entry.name === file.name)).concat(replacements).sort((a, b) => a.name.localeCompare(b.name))
if (files.reduce((sum, file) => sum + file.bytes, 0) > 950000000) throw new Error('Candidate exceeds the runtime payload allowance; public image is unchanged')
for (const name of unchanged) if (sha(await readFile(path.join(artifact, name))) !== parent.files.find((file) => file.name === name).sha256) throw new Error(`Compiled asset was modified during repack: ${name}`)
const template = await templateMetadata(root)
if (JSON.stringify(template) !== JSON.stringify(templateBefore) || sha(await readFile(path.join(root, 'guest/Dockerfile'))) !== guestDockerfileSha256) throw new Error('Guest sources changed during the native proof and pack')
for (const entry of replacements) await rename(path.join(output, entry.name), path.join(artifact, entry.name))
const manifest = { ...parent, id: `c2w-node24-${sha(JSON.stringify(files)).slice(0, 16)}`, builtAt: new Date().toISOString(), files,
  source: { ...parent.source, guestDockerfileSha256, preparedTemplate: template,
    rootfsRepack: { parentImage: parent.id, dockerfileSha256: sha(dockerfile), scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))), buildLogSha256: sha(await readFile(logPath)), unchangedCompiledAssets: unchanged.map((name) => parent.files.find((file) => file.name === name)), unchangedBootAssets: bootFiles } },
  verification: { ...parent.verification, nativePreparedTemplate: true, nativeNextStaticExport: true, browser: false } }
await writeFile(path.join(artifact, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Private candidate ready for publication/proof: ${manifest.id}`)
