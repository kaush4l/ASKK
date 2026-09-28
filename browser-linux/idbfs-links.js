/** Preserve guest symlinks without traversing targets outside the browser mount.
 * The pinned Emscripten IDBFS implementation supports only files/directories.
 * Guest links may point into the Linux disk, which MEMFS cannot resolve.
 */
export function installIDBFSSymlinks(FS, IDBFS) {
  if (IDBFS.askkSymlinks) return
  const original = Object.fromEntries(['loadLocalEntry', 'storeLocalEntry', 'removeLocalEntry'].map(name => [name, IDBFS[name].bind(IDBFS)]))
  const maybeStat = path => { try { return FS.lstat(path) } catch (error) { if (error.errno === 44 || error.code === 'ENOENT') return null; throw error } }
  IDBFS.getLocalSet = (mount, callback) => {
    try {
      const entries = {}
      const children = root => FS.readdir(root).filter(name => name !== '.' && name !== '..').map(name => `${root}/${name}`)
      const pending = children(mount.mountpoint.replace(/\/$/, ''))
      while (pending.length) {
        const path = pending.pop(), info = FS.lstat(path)
        if (FS.isDir(info.mode)) pending.push(...children(path))
        entries[path] = { timestamp: info.mtime }
      }
      callback(null, { type: 'local', entries })
    } catch (error) { callback(error) }
  }
  IDBFS.loadLocalEntry = (path, callback) => {
    try {
      const info = FS.lstat(path)
      if (FS.isLink(info.mode)) return callback(null, { timestamp: info.mtime, mode: info.mode, link: FS.readlink(path) })
    } catch (error) { return callback(error) }
    original.loadLocalEntry(path, callback)
  }
  IDBFS.storeLocalEntry = (path, entry, callback) => {
    try {
      const current = maybeStat(path)
      if (FS.isLink(entry.mode)) {
        if (typeof entry.link !== 'string' || entry.link.includes('\0')) throw new Error('Invalid persisted symlink target')
        if (current) FS.unlink(path)
        FS.symlink(entry.link, path)
        // Apply metadata to the link itself; chmod/utime's default path lookup
        // would follow a target that exists only in the guest Linux filesystem.
        const node = FS.lookupPath(path, { follow: false }).node
        node.node_ops.setattr(node, { mode: entry.mode, atime: +entry.timestamp, mtime: +entry.timestamp, ctime: +entry.timestamp })
        return callback(null)
      }
      if (current && FS.isLink(current.mode)) FS.unlink(path)
    } catch (error) { return callback(error) }
    original.storeLocalEntry(path, entry, callback)
  }
  IDBFS.removeLocalEntry = (path, callback) => {
    try {
      if (FS.isLink(FS.lstat(path).mode)) { FS.unlink(path); return callback(null) }
    } catch (error) { return callback(error) }
    original.removeLocalEntry(path, callback)
  }
  IDBFS.askkSymlinks = true
}
