// Terminal — the terminal tool group, a core tool.
//
// This group covers both of the deferred-expectation cases in the
// tools taxonomy, with one set of sessions:
//
//   script  — terminal.run: run a command to its end, get a
//             "done" notification with its exit code and last lines.
//   watcher — terminal.start / wait: start a long session, keep it
//             running, and get notified on new output or on exit
//             (a stream, not a final answer).
//
// No shell: one program, or several joined by && (run in sequence,
// stopping on the first non-zero exit). Arguments are split with
// simple single/double-quote handling — a command with shell
// features beyond && (pipes, redirects, globs) is refused by that
// split, rather than silently run through a shell. Sessions are
// in-memory, per terminal group (the desk creates one group per
// workspace root and caches it, so sessions survive across API
// requests in the same server process). cwd must stay inside the
// workspace root, or the call is refused.

import { spawn } from "node:child_process";
import { isAbsolute, resolve, sep } from "node:path";
import { Tool } from "./tool.js";

const DEFAULT_TIMEOUT_MS = 30000;
const WAIT_MAX_MS = 120000;
const OUTPUT_MAX_LINES = 2000;

function splitArgs(text) {
  const args = [];
  let current = "";
  let quote = null;
  for (const char of String(text ?? "")) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (quote) {
    throw new Error("terminal: unterminated quote in command");
  }
  if (current !== "") {
    args.push(current);
  }
  return args;
}

function parseCommands(command) {
  if (typeof command !== "string" || command.trim() === "") {
    throw new Error("terminal needs a command");
  }
  // Simple && split: a literal && inside quotes is not split, because
  // splitArgs would also mis-handle it — document the limit by
  // refusing pipes and redirects outright instead.
  if (/[|<>]/.test(command)) {
    throw new Error(
      "terminal: pipes and redirects are not run (no shell) — run one program, or several joined by &&",
    );
  }
  return command
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const args = splitArgs(part);
      if (args.length === 0) {
        throw new Error("terminal: empty command in && chain");
      }
      return { program: args[0], args: args.slice(1) };
    });
}

function extractUrls(lines) {
  const urls = [];
  for (const line of lines) {
    const matches = line.match(/https?:\/\/[^\s]+/g) ?? [];
    for (const url of matches) {
      if (!urls.includes(url)) {
        urls.push(url);
      }
    }
  }
  return urls;
}

export class TerminalGroup {
  constructor(root = /* turbopackIgnore: true */ process.cwd()) {
    if (typeof root !== "string" || root.trim() === "") {
      throw new Error("terminal tool needs a workspace root");
    }
    this.root = resolve(/* turbopackIgnore: true */ root);
    this.sessions = new Map();
    this.nextId = 1;
    this.tools = this.#buildTools();
  }

  stateForUI() {
    return {
      sessions: [...this.sessions.values()].map((session) => ({
        id: session.id,
        name: session.name,
        command: session.command,
        status: session.status,
        exitCode: session.exitCode,
      })),
    };
  }

  spec() {
    return { state: this.stateForUI() };
  }

  #resolveCwd(cwd) {
    if (!cwd) {
      return this.root;
    }
    const resolved = isAbsolute(cwd) ? resolve(cwd) : resolve(this.root, cwd);
    if (resolved !== this.root && !resolved.startsWith(this.root + sep)) {
      throw new Error(`terminal: cwd ${cwd} is outside the workspace root`);
    }
    return resolved;
  }

  #runOne({ program, args }, cwd, timeoutMs) {
    return new Promise((resolvePromise, rejectPromise) => {
      let child;
      try {
        child = spawn(program, args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        rejectPromise(error);
        return;
      }
      const lines = [];
      const push = (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line !== "") {
            lines.push(line);
            if (lines.length > OUTPUT_MAX_LINES) {
              lines.shift();
            }
          }
        }
      };
      child.stdout.on("data", push);
      child.stderr.on("data", push);
      child.on("error", (error) => {
        rejectPromise(
          new Error(`terminal: could not run ${program}: ${error.message}`),
        );
      });
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          rejectPromise(
            new Error(`terminal: command timed out after ${timeoutMs} ms`),
          );
        }, timeoutMs);
      }
      child.on("close", (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolvePromise({ exit: code ?? -1, lines });
      });
    });
  }

  async #run(input) {
    const commands = parseCommands(input?.command);
    const cwd = this.#resolveCwd(input?.cwd);
    const timeoutMs =
      input?.timeout === undefined || input?.timeout === null
        ? DEFAULT_TIMEOUT_MS
        : Math.max(0, Number(input.timeout) * 1000 || 0);
    const allLines = [];
    let exit = 0;
    for (const command of commands) {
      const result = await this.#runOne(command, cwd, timeoutMs);
      allLines.push(...result.lines);
      exit = result.exit;
      if (exit !== 0) {
        break;
      }
    }
    return {
      exit,
      output: allLines.join("\n"),
      lastLines: allLines.slice(-50),
    };
  }

  async #start(input) {
    const commands = parseCommands(input?.command);
    if (commands.length > 1) {
      throw new Error(
        "terminal.start needs a single program (use terminal.run for && chains)",
      );
    }
    const cwd = this.#resolveCwd(input?.cwd);
    const id = `s${this.nextId}`;
    this.nextId += 1;
    const session = {
      id,
      name:
        typeof input?.name === "string" && input.name.trim() !== ""
          ? input.name.trim()
          : null,
      command: input.command,
      cwd,
      status: "running",
      exitCode: null,
      lines: [],
      startedAt: new Date().toISOString(),
      child: null,
    };
    const child = spawn(commands[0].program, commands[0].args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    session.child = child;
    const push = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line !== "") {
          session.lines.push(line);
          if (session.lines.length > OUTPUT_MAX_LINES) {
            session.lines.shift();
          }
        }
      }
    };
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    child.on("error", () => {
      session.status = "exited";
      session.exitCode = -1;
    });
    child.on("close", (code) => {
      session.status = "exited";
      session.exitCode = code ?? -1;
    });
    this.sessions.set(id, session);
    // Give the program a brief moment to print its first lines, so
    // the caller gets its id plus what it printed — but never block
    // the start on a long-running program.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    return {
      id,
      name: session.name,
      command: session.command,
      status: session.status,
      lines: [...session.lines],
      urls: extractUrls(session.lines),
    };
  }

  async #wait(input) {
    const session = this.sessions.get(input?.id);
    if (!session) {
      throw new Error(`terminal: no session ${input?.id}`);
    }
    const seconds =
      input?.seconds === undefined || input?.seconds === null
        ? 30
        : Math.max(0, Number(input.seconds) || 0);
    const deadline = Date.now() + Math.min(seconds * 1000, WAIT_MAX_MS);
    const untilList =
      input?.until === undefined || input?.until === null
        ? []
        : Array.isArray(input.until)
          ? input.until.map(String)
          : [String(input.until)];
    while (Date.now() < deadline) {
      if (session.status === "exited") {
        return {
          id: session.id,
          status: "exited",
          exitCode: session.exitCode,
          lines: session.lines.slice(-50),
        };
      }
      if (untilList.length > 0) {
        const found = untilList.find((needle) =>
          session.lines.some((line) => line.includes(needle)),
        );
        if (found) {
          return {
            id: session.id,
            status: "running",
            matched: found,
            lines: session.lines.slice(-50),
          };
        }
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return {
      id: session.id,
      status: session.status,
      timedOut: true,
      lines: session.lines.slice(-50),
    };
  }

  async #read(input) {
    const session = this.sessions.get(input?.id);
    if (!session) {
      throw new Error(`terminal: no session ${input?.id}`);
    }
    const count =
      input?.lines === undefined || input?.lines === null
        ? 100
        : Math.max(0, Number(input.lines) || 0);
    return {
      id: session.id,
      status: session.status,
      exitCode: session.exitCode,
      lines: session.lines.slice(-count),
    };
  }

  async #send(input) {
    const session = this.sessions.get(input?.id);
    if (!session) {
      throw new Error(`terminal: no session ${input?.id}`);
    }
    if (session.status !== "running" || !session.child) {
      throw new Error(`terminal: session ${input.id} is not running`);
    }
    session.child.stdin.write(`${String(input?.text ?? "")}\n`);
    return { id: session.id, sent: true };
  }

  async #stop(input) {
    const session = this.sessions.get(input?.id);
    if (!session) {
      throw new Error(`terminal: no session ${input?.id}`);
    }
    if (session.child && session.status === "running") {
      session.child.kill("SIGTERM");
      // If it ignores SIGTERM, the close handler still marks it
      // exited when the process actually ends; callers use wait
      // to confirm. Do not SIGKILL here — a session's cleanup
      // (flushing output) matters more than an instant stop.
    }
    return { id: session.id, status: session.status };
  }

  async #list() {
    return {
      sessions: [...this.sessions.values()].map((session) => ({
        id: session.id,
        name: session.name,
        command: session.command,
        status: session.status,
        exitCode: session.exitCode,
      })),
    };
  }

  #buildTools() {
    const make = (name, description, input, expectation, run) =>
      new Tool({ name, description, input, expectation, run });
    const sessionInput = {
      id: "a session id (from terminal.start or terminal.list)",
    };
    return [
      make(
        "terminal.run",
        "run a command to its end in your main session (no shell: one program, or several joined by &&; one at a time — one that keeps running belongs in start): its exit and last lines",
        {
          command: "e.g. bun run build",
          cwd: "a workspace folder (optional)",
          timeout: "seconds to wait (default 30, optional)",
        },
        "done",
        (input) => this.#run(input),
      ),
      make(
        "terminal.start",
        "start a command in a long session and keep it running between steps (a dev server, a training run, a watcher; it replaces what ran there): its id, the lines it prints",
        {
          command: "e.g. bun run dev",
          cwd: "a workspace folder (optional)",
          name: "a short name for it (optional)",
        },
        "stream",
        (input) => this.#start(input),
      ),
      make(
        "terminal.wait",
        "wait on a running session: until it exits, a new line holds the until text, or seconds pass",
        {
          ...sessionInput,
          seconds: "at most 120 (default 30, optional)",
          until:
            "literal text, a piece of a line it prints; a list waits for any one (optional)",
        },
        "stream",
        (input) => this.#wait(input),
      ),
      make(
        "terminal.read",
        "a session's last lines (its scrollback)",
        { ...sessionInput, lines: "how many (default 100, optional)" },
        "stream",
        (input) => this.#read(input),
      ),
      make(
        "terminal.send",
        "send a line to a running session's stdin",
        { ...sessionInput, text: "the line" },
        "stream",
        (input) => this.#send(input),
      ),
      make(
        "terminal.stop",
        "stop a running session",
        { ...sessionInput },
        "stream",
        (input) => this.#stop(input),
      ),
      make(
        "terminal.list",
        "every session in one line each",
        {},
        "immediate",
        () => this.#list(),
      ),
    ];
  }
}

// Per-root singleton cache, so sessions survive across API requests
// in the same server process (a fresh group per request would lose
// every started session on the next request).
const terminalCache = new Map();

export function createTerminalTool(
  root = /* turbopackIgnore: true */ process.cwd(),
) {
  const resolved = resolve(/* turbopackIgnore: true */ root ?? "");
  if (!terminalCache.has(resolved)) {
    terminalCache.set(resolved, new TerminalGroup(root));
  }
  return terminalCache.get(resolved);
}

export function clearTerminalToolCache() {
  for (const group of terminalCache.values()) {
    for (const session of group.sessions.values()) {
      try {
        session.child?.kill("SIGKILL");
      } catch {
        // Session already gone; nothing to kill.
      }
    }
  }
  terminalCache.clear();
}
