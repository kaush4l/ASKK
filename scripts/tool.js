// A desk's tool file from the command line (docs/standard.md): check its shape, or run it once against the host.
//
//   bun scripts/tool.js check <file.js>
//        loads it as a desk loads its tools (companion/team/compose.js loadToolFile) and prints each tool's twin();
//        exit 0, or the reason on stderr and exit 1
//   bun scripts/tool.js run <file.js> <tool name> '<json input>' [--desk <name>] [--port <n>]
//        runs it with ctx {host, agent: {name: "cli"}, desk, memory: null, log, signal}; host = the desks' server
//        (default port ASKK_DESKS_PORT or 1111) as --desk (default: the desk folder the file is in); prints the output

import { basename, dirname, resolve } from "node:path"
import { parseArgs } from "node:util"

import { hostClient, loadToolFile } from "../companion/team/compose.js"
import { DESKS_PORT } from "../companion/shared/config.js"

const USAGE = "usage: bun scripts/tool.js check <file.js>\n       bun scripts/tool.js run <file.js> <tool name> '<json input>' [--desk <name>] [--port <n>]"

async function main() {
  const { values: args, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { desk: { type: "string" }, port: { type: "string" } } })
  const [command, file, name, json] = positionals
  if (!file || !["check", "run"].includes(command)) throw new Error(USAGE)
  const tools = await loadToolFile(file)
  if (command === "check") {
    for (const tool of tools) console.log(JSON.stringify(tool.twin(), null, 2))
    return
  }
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`${file}: no tool ${name ?? "(none named)"}; it has ${tools.map((t) => t.name).join(", ")}`)
  let input
  try {
    input = json ? JSON.parse(json) : {}
  } catch (error) {
    throw new Error(`input is not JSON (${error.message})`)
  }
  // custom/<desk>/tools/<file>.js → <desk>
  const folder = dirname(resolve(file))
  const desk = args.desk ?? (basename(folder) === "tools" ? basename(dirname(folder)) : null)
  const port = Number(args.port ?? DESKS_PORT)
  const signal = AbortSignal.timeout(10 * 60_000)
  const out = await tool.run(input, { host: hostClient({ port, desk }), agent: { name: "cli" }, desk, memory: null, log: (line) => console.error(line), signal })
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error.message)
    process.exit(1)
  }
)
