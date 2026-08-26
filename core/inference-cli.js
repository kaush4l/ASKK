/** Claude Code on this machine, driven with `claude -p`.
 *
 * The Python's third transport, ported whole. It is host-only and says so in
 * its filename: a page has no subprocesses, so the `claude` kind joins `KINDS`
 * only where a spawner does (R5), and the gate exempts `*-cli.js` from the
 * purity check for exactly this file.
 *
 * There is no endpoint and no key here — the CLI is already signed in, so
 * `baseUrl` is the path to the binary and `apiKey` goes unused. The prompt goes
 * in on stdin rather than as an argument, because a rendered transcript runs to
 * tens of kilobytes and argv does not.
 *
 * Attachments are written into a scratch directory and named in the prompt:
 * the CLI reads files by path, so that is how an image reaches it. That
 * directory is also the working directory, which keeps a permission-free run
 * from starting out anywhere that matters, and it is removed afterwards.
 *
 * `temperature` and `maxTokens` are ignored — the CLI exposes neither.
 */

import { accessSync, constants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Inference, Multimodality } from "./inference-base.js";
import { isConfigured } from "./ports.js";

/**
 * @typedef {import("./inference-base.js").InferenceOptions} InferenceOptions
 * @typedef {import("./ports.js").SpawnResult} SpawnResult
 */

/** The spawn port, plus the working directory this transport needs.
 * @typedef {(c: string, a: string[], o?: { stdin?: string, timeout?: number, cwd?: string }) => Promise<SpawnResult>} CliSpawn */

/** @typedef {InferenceOptions & { spawn?: CliSpawn, skipPermissions?: boolean,
 *   extraArgs?: string[], which?: (name: string) => string }} CliOptions */

/** @param {string} path @returns {boolean} */
function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `shutil.which`, in the lines of it this needs. The Python hardcoded an
 * absolute path in one person's home directory, so its own `which` fallback
 * could never run (F-9); the default here is the bare name.
 * @param {string} name @returns {string} */
function whichHost(name) {
  if (name.includes("/")) return executable(name) ? name : "";
  const path = String(/** @type {any} */ (globalThis).process?.env?.PATH ?? "");
  for (const dir of path.split(delimiter)) {
    if (dir && executable(join(dir, name))) return join(dir, name);
  }
  return "";
}

/** The file extension for a mime type. `mimetypes.guess_extension` differs
 * from the subtype in the two places worth a table; everything else is the
 * subtype, which is what the Python's own fallback did.
 * @param {string} mime @returns {string} */
function extensionFor(mime) {
  /** @type {Record<string, string>} */
  const known = { "image/jpeg": ".jpg", "audio/mpeg": ".mp3" };
  return known[mime] ?? `.${mime.split("/").pop() ?? "bin"}`;
}

/** @param {string} payload @returns {Uint8Array} */
function decode(payload) {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class ClaudeCLI extends Inference {
  /** @param {CliOptions} [options] */
  constructor(options = {}) {
    super({ ...options, baseUrl: options.baseUrl || "claude", apiKey: options.apiKey ?? "" });
    /** Leave empty to let the CLI use whatever model it is set to. */
    this.model = options.model ?? "";
    /** Pass --dangerously-skip-permissions so a scheduled run is never left waiting on a prompt. */
    this.skipPermissions = options.skipPermissions ?? true;
    /** Further flags passed through verbatim. */
    this.extraArgs = options.extraArgs ?? [];
    /** @type {CliSpawn | undefined} */
    this.spawn = options.spawn;
    const resolved = (options.which ?? whichHost)(this.baseUrl);
    if (!resolved) throw new Error(`claude CLI not found or not executable at '${this.baseUrl}'`);
    this.binary = resolved;
  }

  /** @param {string} prompt @param {Multimodality[]} [multimodal] @returns {Promise<string>} */
  async infer(prompt, multimodal) {
    const workspace = await mkdtemp(join(tmpdir(), "agent-claude-"));
    try {
      return await this.run(await this.withAttachments(prompt, multimodal, workspace), workspace);
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Name every attachment by path, ahead of the prompt. Ahead, not after:
   * the rendered prompt ends on the response cue the model completes from,
   * and putting anything after it buries that cue.
   * @param {string} prompt @param {Multimodality[] | undefined} multimodal @param {string} workspace
   * @returns {Promise<string>}
   */
  async withAttachments(prompt, multimodal, workspace) {
    /** @type {string[]} */
    const paths = [];
    for (const item of multimodal ?? []) {
      for (const url of await item.asDataUrls(this.fs, this.log)) {
        if (!url.startsWith("data:")) {
          paths.push(url); // a remote URL the CLI can fetch itself
          continue;
        }
        const [mime, payload] = Multimodality.splitDataUrl(url);
        const path = join(workspace, `attachment-${paths.length}${extensionFor(mime)}`);
        try {
          await writeFile(path, decode(payload));
        } catch (error) {
          this.log.warn?.(`Skipping unwritable ${item.modalityType} attachment: ${error}`);
          continue;
        }
        paths.push(path);
      }
    }
    if (!paths.length) return prompt;
    return `Attached files — read them before answering:\n${paths.join("\n")}\n\n${prompt}`;
  }

  /** @returns {string[]} */
  buildCommand() {
    const command = [this.binary, "-p", "--output-format", "text"];
    // No --model unless one was asked for: the CLI already has a default, and
    // naming one here would silently override whatever it is set to.
    if (this.model.trim()) command.push("--model", this.model.trim());
    if (this.skipPermissions) command.push("--dangerously-skip-permissions");
    return [...command, ...this.extraArgs];
  }

  /** @param {string} prompt @param {string} workspace @returns {Promise<string>} */
  async run(prompt, workspace) {
    const spawn = this.spawn;
    if (!spawn) throw new Error("no spawn port configured");
    const [command, ...args] = this.buildCommand();
    const ms = this.timeout * 1000;
    /** @type {any} */
    let timer;
    // Two mechanisms, one message: the port is what kills the child, and the
    // race is what names the failure the way the Python named it.
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`claude did not answer within ${this.timeout}s`)), ms);
    });
    /** @type {SpawnResult} */
    let result;
    try {
      result = await Promise.race([spawn(command, args, { stdin: prompt, timeout: ms, cwd: workspace }), expired]);
    } finally {
      clearTimeout(timer);
    }
    if (result.code !== 0) {
      const detail = (result.stderr || "").trim().slice(-500);
      throw new Error(`claude exited ${result.code}: ${detail || "no output"}`);
    }
    return (result.stdout || "").trim();
  }
}

/**
 * Put the `claude` kind in a `KINDS` table — on the host, where a spawner is.
 *
 * A function rather than a mutation at import time: registering on import puts
 * the kind in the table of every build that merely touched this module, and
 * the point of R5 is that a browser build does not have it. A stub spawn is
 * refused for the same reason — a kind that loads and fails at the call is
 * worse than one honestly absent.
 *
 * @param {Record<string, new (options?: InferenceOptions) => Inference>} kinds
 * @param {CliSpawn | undefined} spawn
 * @returns {Record<string, new (options?: InferenceOptions) => Inference>}
 */
export function registerCliKind(kinds, spawn) {
  if (!isConfigured(spawn)) return kinds;
  kinds.claude = class extends ClaudeCLI {
    /** @param {InferenceOptions} [options] */
    constructor(options = {}) {
      super({ ...options, spawn });
    }
  };
  return kinds;
}
