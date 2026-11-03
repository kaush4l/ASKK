// Core tools — the default tools shipped with every desk.
//
// This is the shipped set, confirmed by Kaushal (web is ignored for
// now — no web tools here, in the registry, or in the UI):
//
//   files.*    — the filesystem tool group (src/core/files.js):
//                list, read, write, edit, append, search, open,
//                close, focus (including the focus-section form
//                for when a file is too big)
//   terminal.* — the terminal tool group (src/core/terminal.js):
//                run, start, wait, read, send, stop, list
//
// Everything else from the old builtin kit — plan, goal, dispatch,
// workflow, practice, preview, browse, talk, ask, desk.*, agent
// spawn, dev, studio, surgeon, audio, speech — is desk-specific or
// later, not core. A desk may add its own tools on top of these;
// it never has to re-declare them.
//
//   const core = createCoreTools({ filesLocation: "/path/to/project" });
//   core.tools;      // flat list of Tool instances (files + terminal)
//   core.registry;   // createToolRegistry(core.tools)
//   core.listTools(); // plain specs, for the UI and /api/tools
//
// No web tools: coreTools() must never return a tool whose name
// starts with "web." — the tests assert that.

import { createFilesTool } from "./files.js";
import { createTerminalTool } from "./terminal.js";
import { createToolRegistry } from "./tool.js";

export const CORE_TOOL_NAMES = Object.freeze([
  "files.list",
  "files.read",
  "files.write",
  "files.edit",
  "files.append",
  "files.search",
  "files.open",
  "files.close",
  "files.focus",
  "terminal.run",
  "terminal.start",
  "terminal.wait",
  "terminal.read",
  "terminal.send",
  "terminal.stop",
  "terminal.list",
]);

export function createCoreTools({
  filesLocation,
  filesId = "files",
  terminalRoot,
} = {}) {
  const root = filesLocation ?? process.cwd();
  const files = createFilesTool(root, filesId);
  const terminal = createTerminalTool(terminalRoot ?? root);
  const tools = [...files.tools, ...terminal.tools];
  // Guard the confirmed set: web is ignored for now, and a future
  // edit must not silently add a tool to the default without
  // updating CORE_TOOL_NAMES above.
  const names = tools.map((tool) => tool.name);
  if (names.some((name) => name.startsWith("web."))) {
    throw new Error("core tools must not include web tools (ignored for now)");
  }
  const registry = createToolRegistry(tools);
  return {
    tools,
    registry,
    files,
    terminal,
    listTools() {
      return registry.specs();
    },
    describeAll() {
      return registry.describeAll();
    },
  };
}
