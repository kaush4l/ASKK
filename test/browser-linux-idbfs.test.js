import { test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installIDBFSSymlinks } from '../public/browser-linux/idbfs-links.js'

// Use real symlinks, including dangling guest-only targets. The existing IDBFS
// file/directory methods are represented here; the adapter owns only link cases.
function filesystem() {
  const FS = {
    lstat: fs.lstatSync, readdir: fs.readdirSync, readlink: fs.readlinkSync,
    unlink: fs.unlinkSync, symlink: fs.symlinkSync,
    isDir: mode => (mode & 0o170000) === 0o040000,
    isLink: mode => (mode & 0o170000) === 0o120000,
    lookupPath: location => ({ node: { location, node_ops: { setattr(node, attrs) { fs.lutimesSync(node.location, new Date(attrs.atime), new Date(attrs.mtime)) } } } }),
  }
  const IDBFS = {
    loadLocalEntry(location, callback) { const info = fs.statSync(location); callback(null, { mode: info.mode, timestamp: info.mtime, contents: info.isFile() ? fs.readFileSync(location) : undefined }) },
    storeLocalEntry(location, entry, callback) { if (FS.isDir(entry.mode)) fs.mkdirSync(location, { recursive: true }); else fs.writeFileSync(location, entry.contents); callback(null) },
    removeLocalEntry(location, callback) { if (fs.statSync(location).isDirectory()) fs.rmdirSync(location); else fs.unlinkSync(location); callback(null) },
  }
  installIDBFSSymlinks(FS, IDBFS)
  const call = (method, ...args) => new Promise((resolve, reject) => IDBFS[method](...args, (error, result) => error ? reject(error) : resolve(result)))
  return { FS, IDBFS, call }
}

test('workspace checkpointing retains dangling guest links and never traverses external dependencies', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askk-idbfs-links-'))
  try {
    const workspace = path.join(root, 'workspace'), external = path.join(root, 'external')
    fs.mkdirSync(workspace); fs.mkdirSync(external)
    fs.writeFileSync(path.join(workspace, 'package.json'), '{}')
    fs.writeFileSync(path.join(external, 'private.js'), 'outside workspace')
    const modules = path.join(workspace, 'node_modules'), relative = path.join(workspace, 'relative-link')
    fs.symlinkSync('/opt/harness/template/node_modules', modules)
    fs.symlinkSync('../external', relative)
    const { call } = filesystem()
    const entries = (await call('getLocalSet', { mountpoint: workspace })).entries
    expect(Object.keys(entries).sort()).toEqual([modules, path.join(workspace, 'package.json'), relative].sort())
    const saved = await call('loadLocalEntry', modules), savedRelative = await call('loadLocalEntry', relative)
    expect(saved.link).toBe('/opt/harness/template/node_modules')
    expect(savedRelative.link).toBe('../external')
    await call('removeLocalEntry', modules); await call('removeLocalEntry', relative)
    await call('storeLocalEntry', modules, structuredClone(saved))
    await call('storeLocalEntry', relative, structuredClone(savedRelative))
    expect(fs.readlinkSync(modules)).toBe(saved.link)
    expect(fs.readlinkSync(relative)).toBe('../external')
    expect(fs.lstatSync(modules).mtimeMs).toBeCloseTo(saved.timestamp.getTime(), -1)
    expect(fs.readFileSync(path.join(external, 'private.js'), 'utf8')).toBe('outside workspace')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('restoring a regular file over a prior link does not write through that link', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askk-idbfs-target-'))
  try {
    const target = path.join(root, 'target'), entry = path.join(root, 'entry')
    fs.writeFileSync(target, 'preserve target'); fs.symlinkSync(target, entry)
    const { FS, IDBFS, call } = filesystem()
    installIDBFSSymlinks(FS, IDBFS)
    await call('storeLocalEntry', entry, { mode: 0o100644, contents: new TextEncoder().encode('restored file') })
    expect(fs.lstatSync(entry).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(entry, 'utf8')).toBe('restored file')
    expect(fs.readFileSync(target, 'utf8')).toBe('preserve target')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
