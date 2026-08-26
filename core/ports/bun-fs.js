/** The host filesystem adapter — `node:fs`, rooted at a workspace.
 *
 * This is one of the two places the impurity is allowed to live (the gate
 * exempts `core/ports/` by name). Everything above it sees only the `FsPort`
 * contract, which is what lets the same core run on the host, in a worker and
 * in a page.
 *
 * The contract's one real guarantee is `replace`, and this adapter delivers it
 * the way the Python did: a temporary beside the target and then a rename.
 */

import { access, appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** @typedef {import("../ports.js").FsPort} FsPort */

/**
 * @param {unknown} error
 * @returns {string}
 */
function codeOf(error) {
  return String(/** @type {{ code?: unknown }} */ (error ?? {}).code ?? "");
}

/**
 * Create the parents a write is about to need.
 *
 * The contract says `write` creates parent directories, because every caller
 * above here — the log, `space.json`, a skill file — writes into a folder that
 * may not exist yet on a fresh project, and making each of them check first
 * would put the same three lines in five places.
 *
 * @param {string} target
 */
async function ensureParent(target) {
  await mkdir(dirname(target), { recursive: true });
}

/**
 * The file's text, or null for a miss. A miss is a normal state — a fresh
 * project has no log and no space.json — so it is a value. Anything else is a
 * real failure and travels, because a silently empty read loses a conversation.
 * @param {string} target @returns {Promise<string | null>}
 */
async function readText(target) {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * Through a temporary and then a rename, never in place: replacing in place
 * leaves the file truncated if anything fails mid-write, and a reader must see
 * the old file or the new one and never half of either. The suffix is appended
 * rather than substituted — the Python's `with_suffix` replaced it, which is
 * wrong for any multi-dot name (D-5).
 * @param {string} target @param {string} text
 */
async function replaceText(target, text) {
  const temporary = `${target}.tmp`;
  await ensureParent(target);
  await writeFile(temporary, text, "utf8");
  try {
    await rename(temporary, target);
  } catch (error) {
    // The temporary is the only casualty: whatever was at the target is still
    // there, whole, which is the guarantee the caller bought. A stale temp
    // left behind is how a crash becomes a second bug (D-6).
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * The immediate children, sorted on the bare name and then marked: appending
 * the marker first would sort `a/` after `a.md`, and `skills.js` tells
 * `<name>/SKILL.md` from a bare `<name>.md` by exactly that marker. A missing
 * directory is `[]` — no skills is a normal state for a fresh project.
 * @param {string} target @returns {Promise<string[]>}
 */
async function listDir(target) {
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") return [];
    throw error;
  }
  return entries
    .map((entry) => ({ name: entry.name, dir: entry.isDirectory() }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => (entry.dir ? `${entry.name}/` : entry.name));
}

/** @param {string} target @returns {Promise<boolean>} */
async function existsAt(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * An `FsPort` over the real filesystem.
 *
 * @param {string} [root] the workspace every path is resolved against
 * @returns {FsPort}
 */
export function bunFs(root = ".") {
  /** @param {string} path */
  const at = (path) => join(root, path);
  return {
    read: (path) => readText(at(path)),
    write: async (path, text) => {
      await ensureParent(at(path));
      await writeFile(at(path), text, "utf8");
    },
    append: async (path, text) => {
      await ensureParent(at(path));
      await appendFile(at(path), text, "utf8");
    },
    replace: (path, text) => replaceText(at(path), text),
    list: (path) => listDir(at(path)),
    // `fs.rmdir(path, { recursive: true })` throws as of Bun 1.4; `rm` is the
    // one that still removes a tree. `force` makes a missing path the
    // non-event the contract says it is.
    remove: async (path) => void (await rm(at(path), { recursive: true, force: true })),
    exists: (path) => existsAt(at(path)),
  };
}
