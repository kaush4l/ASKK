/** The browser filesystem adapter — the Origin Private File System.
 *
 * The same `FsPort` contract the host adapter implements, over
 * `navigator.storage.getDirectory()`. Directories are made on the way down
 * when something is written and never otherwise, so a fresh origin holds
 * nothing until the first turn.
 *
 * OPFS has no rename, which is the one thing `replace` was built out of — see
 * the comment on `replace` for what is done instead and why it is weaker.
 */

/** @typedef {import("../ports.js").FsPort} FsPort */

/** What the spec gives a directory handle and `lib.dom` does not yet declare.
 * @typedef {FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }} Directory */

/** @param {string} path @returns {string[]} */
function segments(path) {
  return String(path)
    .split("/")
    .filter((part) => part !== "" && part !== ".");
}

/** @param {unknown} error @returns {boolean} */
function isMissing(error) {
  const name = String(/** @type {{ name?: unknown }} */ (error ?? {}).name ?? "");
  return name === "NotFoundError" || name === "TypeMismatchError";
}

/**
 * Walk to a directory, optionally creating it.
 * @param {Directory} root @param {string[]} parts @param {boolean} create
 * @returns {Promise<Directory | null>}
 */
async function descend(root, parts, create) {
  let here = root;
  for (const part of parts) {
    try {
      here = /** @type {Directory} */ (await here.getDirectoryHandle(part, { create }));
    } catch (error) {
      if (!create && isMissing(error)) return null;
      throw error;
    }
  }
  return here;
}

/**
 * The directory holding `path`, and the name within it.
 * @param {Directory} root @param {string} path @param {boolean} create
 * @returns {Promise<{ dir: Directory, name: string } | null>}
 */
async function locate(root, path, create) {
  const parts = segments(path);
  const name = parts.pop() ?? "";
  if (!name) return null;
  const dir = await descend(root, parts, create);
  return dir ? { dir, name } : null;
}

/**
 * Write a whole file. `createWritable` buffers into a swap file and commits at
 * `close()`, so a reader sees the old bytes or the new ones.
 * @param {Directory} dir @param {string} name @param {string} text @param {boolean} [keep]
 */
async function put(dir, name, text, keep = false) {
  const handle = await dir.getFileHandle(name, { create: true });
  const stream = await handle.createWritable({ keepExistingData: keep });
  try {
    if (keep) await stream.write({ type: "write", position: (await handle.getFile()).size, data: text });
    else await stream.write(text);
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
  await stream.close();
}

/** @param {Directory} root @param {string} path @returns {Promise<string | null>} */
async function readAt(root, path) {
  const spot = await locate(root, path, false);
  if (!spot) return null;
  try {
    return await (await (await spot.dir.getFileHandle(spot.name)).getFile()).text();
  } catch (error) {
    // A miss is a normal state, so it is a value and never a throw.
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * There is no rename here. What the host gets from `rename` — a reader sees
 * the whole old file or the whole new one — this gets from two weaker things
 * stacked: the bytes are landed in a sibling temporary first, so they survive
 * a failure of the second write, and the target is then written through a
 * writable stream, which the spec commits at `close()` rather than on the way.
 * It is weaker because that second half is a property of how a writable stream
 * is implemented rather than a filesystem operation, and because a crash
 * between the two leaves the temporary behind. It is still the best available:
 * the one engine that offers `FileSystemFileHandle.move()` is not every
 * engine, and a replace that is atomic in Chrome alone is worse than one that
 * behaves the same everywhere.
 * @param {Directory} root @param {string} path @param {string} text
 */
async function replaceAt(root, path, text) {
  const spot = await locate(root, path, true);
  if (!spot) return;
  const temporary = `${spot.name}.tmp`;
  await put(spot.dir, temporary, text);
  try {
    await put(spot.dir, spot.name, text);
  } finally {
    // The temporary is never left to rot: a stale one is how a crash becomes
    // a second bug that nobody reads (D-6).
    await spot.dir.removeEntry(temporary).catch(() => {});
  }
}

/**
 * The immediate children, sorted on the bare name and then marked: appending
 * the marker first would sort `a/` after `a.md`, and `skills.js` tells
 * `<name>/SKILL.md` from a bare `<name>.md` by exactly that marker.
 * @param {Directory} root @param {string} path @returns {Promise<string[]>}
 */
async function listAt(root, path) {
  const dir = await descend(root, segments(path), false);
  if (!dir) return [];
  /** @type {[string, boolean][]} */
  const children = [];
  for await (const [name, handle] of dir.entries()) children.push([name, handle.kind === "directory"]);
  children.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return children.map(([name, isDir]) => (isDir ? `${name}/` : name));
}

/** @param {Directory} root @param {string} path */
async function removeAt(root, path) {
  const spot = await locate(root, path, false);
  if (!spot) return;
  // A missing path is not an error, which is what this catch says.
  await spot.dir.removeEntry(spot.name, { recursive: true }).catch((error) => {
    if (!isMissing(error)) throw error;
  });
}

/** @param {Directory} root @param {string} path @returns {Promise<boolean>} */
async function existsAt(root, path) {
  const spot = await locate(root, path, false);
  if (!spot) return false;
  for (const get of [() => spot.dir.getFileHandle(spot.name), () => spot.dir.getDirectoryHandle(spot.name)]) {
    try {
      await get();
      return true;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return false;
}

/**
 * An `FsPort` over OPFS.
 *
 * @param {object} [options]
 * @param {string} [options.root] a subdirectory of the origin's store to live in
 * @param {() => Promise<FileSystemDirectoryHandle>} [options.open] for a test double
 * @returns {FsPort}
 */
export function opfsFs(options = {}) {
  const open = options.open ?? (() => navigator.storage.getDirectory());
  /** @type {Promise<Directory> | null} */
  let opened = null;
  // Resolved once and lazily: a page that never touches the filesystem must
  // not be the page that asks for storage.
  const rootDir = () => (opened ??= Promise.resolve(open()).then((handle) =>
    descend(/** @type {Directory} */ (handle), segments(options.root ?? ""), true).then(
      (dir) => /** @type {Directory} */ (dir),
    ),
  ));

  return {
    read: async (path) => readAt(await rootDir(), path),
    write: async (path, text) => {
      const spot = await locate(await rootDir(), path, true);
      if (spot) await put(spot.dir, spot.name, text);
    },
    append: async (path, text) => {
      const spot = await locate(await rootDir(), path, true);
      if (spot) await put(spot.dir, spot.name, text, true);
    },
    replace: async (path, text) => replaceAt(await rootDir(), path, text),
    list: async (path) => listAt(await rootDir(), path),
    remove: async (path) => removeAt(await rootDir(), path),
    exists: async (path) => existsAt(await rootDir(), path),
  };
}
