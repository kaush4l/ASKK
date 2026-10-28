// The composition as a document (2026-10-26 owner: "make it easy for both the user and LLM, the self architecture … how
// to make changes such that it aligns to a standard … update the documentation for long term"): docs/composition.md is
// written from the kernel's own description of its classes (backend/kernel/classes.js), never by hand, so it cannot drift.
//
//   bun scripts/composition.js            writes docs/composition.md
//   bun scripts/composition.js --check    exit 1 when docs/composition.md is stale or a class is off the standard:
//                                         the kernel's checks (about, declared commands, a bare instance) and the
//                                         repository's (its view has a renderer in components/views/artifact.jsx, a
//                                         kit artifact has its test, backend/kernel/README.md names it)
//   bun scripts/composition.js --json     prints the catalogue
//
// The dev desk runs --check as its `composition` check: a change to a class lands with its document.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { kernelClasses } from "../backend/kernel/index.js"

const ROOT = resolve(import.meta.dir, "..")
const DOC = "docs/composition.md"

const cell = (x) => String(x ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ")
const table = (head, rows) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n")

// The views components/views/artifact.jsx draws (its VIEWS table's keys).
export function viewsDrawn(source) {
  const block = source.match(/const VIEWS = \{([\s\S]*?)\n\}/)?.[1] ?? ""
  return new Set([...block.matchAll(/^\s*["']?([a-z][a-z0-9_-]*)["']?\s*:/gm)].map((m) => m[1]))
}

// What the repository lacks for a class: its view's renderer, its test, its README entry.
export function fileProblems(k, { views, readme, exists }) {
  const problems = []
  if (k.view && !views.has(k.view)) problems.push(`view ${k.view} has no renderer in components/views/artifact.jsx`)
  if (k.type && ![`builtin-${k.type}.test.js`, `${k.type}.test.js`].some((f) => exists(`backend/kernel/test/${f}`))) problems.push(`no backend/kernel/test/builtin-${k.type}.test.js`)
  if (!new RegExp(`\\b${k.name}\\b`).test(readme)) problems.push("backend/kernel/README.md does not name it")
  return problems
}

export function compositionMarkdown(c, extra = {}) {
  const out = []
  const say = (...lines) => out.push(...lines)
  say(
    "# Composition — the kernel's classes, their variables, instances and how to change them",
    "",
    "<!-- Written by `bun scripts/composition.js` from backend/kernel/classes.js and each class's statics. Do not edit by hand:",
    "     change the class (or BASES in classes.js) and run the script; `--check` fails while this file is stale. -->",
    "",
    "ASKK is plain classes composed by configuration. Every object on a desk is an instance of one of the classes below;",
    "the live board of instances is the **/compose** page, which draws these classes beside them (a click on an instance",
    "names its class and where a change to it goes). Read this file before changing ASKK itself: find the class, follow its",
    "*How to change*, keep it on the standard, run the checks, then run `bun scripts/composition.js`.",
    "",
    "Layers: configuration (`custom/<desk>/` files) → `composeDesk` → kernel instances (`Desk`, `Agent`, `Tool`, `Artifact`s)",
    "→ the desk server streams their twins → the tab draws each twin by its view. Map: docs/architecture.md; rules:",
    "docs/philosophy.md; the desk format: docs/standard.md.",
    "",
    "## Changing ASKK from within",
    "",
    "1. Name the object (an agent, a tool, an artifact, a workflow) and look up its class here or on /compose.",
    "2. A change to one instance is configuration: its `.md`, `main.js` or workflow file. A change to every instance is its class.",
    "3. Follow the class's *How to change*; a new event, field or command lands with its UI twin in the same change.",
    "4. Run its tests, `bun test` in backend/ and components/, and `bun scripts/composition.js --check`.",
    "5. Run `bun scripts/composition.js` so this file follows; add the dated note to CLAUDE.md / backend/kernel/README.md.",
    "6. Kernel, companion or custom/shared changes need the server restarted (the dev desk's `dev.restart`: supervised, rolled back when it breaks).",
    "",
    "## The standard",
    "",
    ...c.standard.map((r) => `- **${r.rule}** — ${r.says}`),
    "",
  )
  const kinds = c.kinds
  const off = kinds.filter((k) => k.problems.length || extra[k.name]?.length)
  say(off.length ? `**${off.length} of ${kinds.length} off the standard:**` : `All ${kinds.length} artifact classes are aligned.`, "")
  for (const k of off) say(`- ${k.name}: ${[...k.problems, ...(extra[k.name] ?? [])].join("; ")}`)
  if (off.length) say("")

  say("## Base classes", "")
  for (const b of c.bases) {
    say(`### ${b.name}${b.abstract ? " (abstract)" : ""}${b.extends ? ` extends ${b.extends}` : ""}`, "", b.says, "", `File: \`${b.file}\``, "")
    if (b.variables.length) say("Variables:", "", table(["name", "set in", "frontmatter key", "means"], b.variables.map((x) => [`\`${x.name}\``, x.where, x.key ?? "", x.says])), "")
    if (b.hooks.length) say("Hooks:", "", ...b.hooks.map((x) => `- \`${x.name}\` — ${x.says}`), "")
    say("How to change:", "", ...b.change.map((x, i) => `${i + 1}. ${x}`), "", `Tests: ${b.tests}. Docs: ${b.docs}.`, "")
  }

  say("## Artifact classes", "", "Read from each class (its statics and a bare instance): what is here is what the code declares.", "")
  say(table(["class", "kit type", "extends", "kind", "view", "keep", "commands", "owner calls", "standard"], kinds.map((k) => [k.name, k.type ?? "(kernel)", k.extends, k.kind, k.view, k.keep, k.commands.length, k.owner.length, k.problems.length || extra[k.name]?.length ? "off" : "aligned"])), "")
  for (const k of kinds) {
    say(`### ${k.name}`, "", k.says || "_(no static about)_", "", `File: \`${k.file}\` · extends ${k.extends} · kind \`${k.kind}\` · view \`${k.view}\` · keep \`${k.keep}\`${k.poll ? ` · poll ${k.poll} ms` : ""} · commands type \`${k.commandType ?? "dev"}\``, "")
    if (k.options) say(`Options (main.js \`builtin.${k.type}\`):`, "", ...Object.entries(k.options).map(([o, s]) => `- \`${o}\` — ${s}`), "")
    say(`State: ${k.state.map((s) => `\`${s}\``).join(", ") || "—"}`, "")
    if (k.commands.length) say("Commands:", "", ...k.commands.map((x) => `- \`${k.type ?? k.kind}.${x.name}\`${x.usage ? ` \`${x.usage}\`` : ""} — ${x.says.split("\n")[0]}`), "")
    say(`Owner calls: ${k.owner.join(", ") || "none"}. Hooks it defines: ${k.hooks.join(", ") || "none"}.`, "")
  }

  say("## Kit tools", "", "Attached by name (`tools: [web.search, agent.spawn]`); a desk's own tool of the same name wins.", "")
  say(table(["tool", "type", "view", "outside", "does"], c.tools.map((t) => [`\`${t.name}\``, t.type, t.view, t.outside ? "yes" : "", t.says])), "")
  return out.join("\n")
}

function main() {
  const args = Bun.argv.slice(2)
  const c = kernelClasses()
  if (args.includes("--json")) return console.log(JSON.stringify(c, null, 2))
  const read = (p) => readFileSync(join(ROOT, p), "utf8")
  const ctx = { views: viewsDrawn(read("components/views/artifact.jsx")), readme: read("backend/kernel/README.md"), exists: (p) => existsSync(join(ROOT, p)) }
  const extra = Object.fromEntries(c.kinds.map((k) => [k.name, fileProblems(k, ctx)]).filter(([, p]) => p.length))
  const text = compositionMarkdown(c, extra) + "\n"
  if (!args.includes("--check")) {
    writeFileSync(join(ROOT, DOC), text)
    return console.log(`wrote ${DOC}: ${c.bases.length} bases, ${c.kinds.length} artifact classes, ${c.tools.length} kit tools`)
  }
  const problems = [
    ...(existsSync(join(ROOT, DOC)) && read(DOC) === text ? [] : [`${DOC} is stale: run bun scripts/composition.js`]),
    ...c.kinds.flatMap((k) => [...k.problems, ...(extra[k.name] ?? [])].map((p) => `${k.name}: ${p}`)),
  ]
  if (problems.length) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  console.log(`composition ok: ${c.kinds.length} artifact classes aligned, ${DOC} current`)
}

if (import.meta.main) main()
