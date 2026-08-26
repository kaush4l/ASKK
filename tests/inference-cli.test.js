/** Wave 4.5 — `ClaudeCLI`, the host-only transport (PORT-MAP R5).
 *
 * Driven through a fake spawner, which is where every claim about this class
 * actually lives: what goes on argv, what goes on stdin, what the working
 * directory is, and what is left on disk afterwards.
 */

import { test, expect } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeCLI, registerCliKind } from "../core/inference-cli.js";
import { Inference, Multimodality } from "../core/inference-base.js";
import { defaultPorts } from "../core/ports.js";

/** A spawner that records its call and answers with whatever it is given. */
function fakeSpawn(answer = { code: 0, stdout: "  the reply  \n", stderr: "" }) {
  /** @type {any} */
  const seen = { calls: [] };
  /** @param {string} command @param {string[]} args @param {any} [options] */
  const spawn = async (command, args, options = {}) => {
    const listing = await readdir(options.cwd ?? ".");
    seen.calls.push({ command, args, ...options, listing });
    return answer;
  };
  return { spawn, seen };
}

/** The binary is present and executable, without asking the machine. */
const which = () => "/usr/local/bin/claude";

test("the default binary is the bare name, resolved through the path (F-9)", () => {
  /** @type {string[]} */
  const asked = [];
  const cli = new ClaudeCLI({ spawn: fakeSpawn().spawn, which: (name) => (asked.push(name), "/x/claude") });
  // The Python hardcoded /Users/<someone>/.local/bin/claude, which meant its
  // own `which` fallback could never run.
  expect(asked).toEqual(["claude"]);
  expect(cli.binary).toBe("/x/claude");
});

test("a binary that cannot be found is a construction error, not a call-time one", () => {
  expect(() => new ClaudeCLI({ spawn: fakeSpawn().spawn, which: () => "" })).toThrow(
    "claude CLI not found or not executable at 'claude'",
  );
  expect(() => new ClaudeCLI({ baseUrl: "/nope/claude", spawn: fakeSpawn().spawn, which: () => "" })).toThrow(
    "claude CLI not found or not executable at '/nope/claude'",
  );
});

test("the command names no model unless one was asked for", () => {
  const spawn = fakeSpawn().spawn;
  expect(new ClaudeCLI({ spawn, which }).buildCommand()).toEqual([
    "/usr/local/bin/claude", "-p", "--output-format", "text", "--dangerously-skip-permissions",
  ]);
  const named = new ClaudeCLI({ spawn, which, model: " opus ", skipPermissions: false, extraArgs: ["--verbose"] });
  expect(named.buildCommand()).toEqual([
    "/usr/local/bin/claude", "-p", "--output-format", "text", "--model", "opus", "--verbose",
  ]);
});

test("the prompt goes in on stdin, in a scratch directory that is also the cwd", async () => {
  const { spawn, seen } = fakeSpawn();
  const cli = new ClaudeCLI({ spawn, which });
  expect(await cli.infer("a very long rendered transcript")).toBe("the reply");
  const call = seen.calls[0];
  // argv does not hold tens of kilobytes; stdin does.
  expect(call.stdin).toBe("a very long rendered transcript");
  expect(call.args).not.toContain("a very long rendered transcript");
  expect(call.cwd).toContain("agent-claude-");
  // A permission-free run never starts anywhere that matters, and the
  // directory does not outlive the call.
  await expect(stat(call.cwd)).rejects.toBeDefined();
});

test("attachments are written into the scratch directory and named ahead of the prompt", async () => {
  const { spawn, seen } = fakeSpawn();
  const cli = new ClaudeCLI({ spawn, which });
  const image = new Multimodality({ modalityType: "image", collection: ["data:image/jpeg;base64,QUJD"] });
  const remote = new Multimodality({ modalityType: "video", collection: ["https://example.test/clip.mp4"] });
  await cli.infer("the question", [image, remote]);
  const call = seen.calls[0];
  const [head, ...rest] = call.stdin.split("\n");
  expect(head).toBe("Attached files — read them before answering:");
  // Ahead, not after: the prompt ends on the response cue the model completes
  // from, and anything after it buries that cue.
  expect(call.stdin.endsWith("\n\nthe question")).toBe(true);
  expect(rest[0].endsWith("attachment-0.jpg")).toBe(true);
  expect(rest[1]).toBe("https://example.test/clip.mp4");
  // It was really on disk while the process was running.
  expect(call.listing).toEqual(["attachment-0.jpg"]);
});

test("a prompt with no attachments is passed through untouched", async () => {
  const { spawn, seen } = fakeSpawn();
  await new ClaudeCLI({ spawn, which }).infer("just the prompt", []);
  expect(seen.calls[0].stdin).toBe("just the prompt");
});

test("a non-zero exit carries the binary's own words", async () => {
  const { spawn } = fakeSpawn({ code: 2, stdout: "", stderr: "  not logged in  " });
  await expect(new ClaudeCLI({ spawn, which }).infer("x")).rejects.toThrow("claude exited 2: not logged in");
});

test("a silent non-zero exit still says which code it was", async () => {
  const { spawn } = fakeSpawn({ code: 127, stdout: "", stderr: "" });
  await expect(new ClaudeCLI({ spawn, which }).infer("x")).rejects.toThrow("claude exited 127: no output");
});

test("a run that never answers fails on the timeout, by that name", async () => {
  const spawn = () => new Promise(() => {});
  const cli = new ClaudeCLI({ spawn, which, timeout: 0.01 });
  await expect(cli.infer("x")).rejects.toThrow("claude did not answer within 0.01s");
});

test("the claude kind is registered where a spawner is, and nowhere else", () => {
  /** @type {Record<string, new (options?: any) => Inference>} */
  const kinds = {};
  // `defaultPorts().spawn` exists and throws at the call: registering on its
  // presence would be a kind that loads and then fails.
  registerCliKind(kinds, /** @type {any} */ (defaultPorts().spawn));
  expect(Object.keys(kinds)).toEqual([]);
  registerCliKind(kinds, fakeSpawn().spawn);
  expect(Object.keys(kinds)).toEqual(["claude"]);
  const built = new kinds.claude({ which });
  expect(built).toBeInstanceOf(ClaudeCLI);
  expect(built).toBeInstanceOf(Inference);
});
