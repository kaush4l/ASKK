/** The host cron adapter — the real `crontab` binary, through the spawn port.
 *
 * `core/schedule.js` holds the rules; this holds the file. The split is what
 * lets the same rules run in a page, where there is no crontab at all.
 *
 * Everything that matters here is in `readLines`. `crontab -` replaces the
 * whole file, so every edit is "read every line, change the one that is mine,
 * write them all back" — and a read that fails for any reason other than "no
 * crontab yet" must throw, because rewriting a file we could not see is how
 * other people's jobs disappear.
 *
 * Set `AGENT_CRONTAB` to a different binary to work against something other
 * than the real schedule; the tests use it to stay off it entirely.
 */

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * @typedef {import("../ports.js").CronPort} CronPort
 * @typedef {import("../ports.js").SpawnPort} SpawnPort
 */

/** @param {string} path @returns {boolean} */
function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `shutil.which`, in the twelve lines of it this needs.
 * @param {string} name @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function which(name, env) {
  if (name.includes("/")) return executable(name) ? name : "";
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (executable(candidate)) return candidate;
  }
  return "";
}

/**
 * `str.splitlines()`: a trailing newline ends the last line, it does not begin
 * an empty one. An empty string is no lines at all, not one blank one — which
 * matters, because a blank line written back becomes a blank crontab entry.
 * @param {string} text @returns {string[]}
 */
function splitLines(text) {
  if (!text) return [];
  return text.replace(/\n$/, "").split("\n");
}

/**
 * A `CronPort` over the system crontab.
 *
 * @param {object} options
 * @param {SpawnPort} options.spawn
 * @param {Record<string, string | undefined>} [options.env]
 * @returns {CronPort}
 */
export function cronHost({ spawn, env = /** @type {any} */ (globalThis).process?.env ?? {} }) {
  const binary = () => {
    const command = env.AGENT_CRONTAB || which("crontab", env);
    if (!command) throw new Error("no 'crontab' command on this system");
    return command;
  };

  return {
    async readLines() {
      const result = await spawn(binary(), ["-l"]);
      if (result.code === 0) return splitLines(result.stdout);
      // "No crontab for you" is not a failure to read; it is an empty file
      // that the tool has never been asked to create.
      if ((result.stderr || "").toLowerCase().includes("no crontab")) return [];
      throw new Error((result.stderr || "").trim() || `crontab -l exited ${result.code}`);
    },

    async writeLines(lines) {
      const body = lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
      const result = await spawn(binary(), ["-"], { stdin: body ? `${body}\n` : "" });
      if (result.code !== 0) {
        throw new Error((result.stderr || "").trim() || `crontab - exited ${result.code}`);
      }
    },
  };
}
