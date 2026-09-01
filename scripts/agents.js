#!/usr/bin/env bun
/**
 * Publish `agents/` into `public/agents/` so the built app can read it.
 *
 * The files are COPIED, not compiled. An agent stays a markdown file in the
 * deployed output, which is what lets someone change how an agent behaves by
 * editing a file and reloading — no toolchain on the machine running it.
 *
 * A directory cannot be listed over HTTP, so the one thing this generates is
 * `index.json`: the roster the app fetches to learn who exists.
 *
 * Measured, and the reason the frontmatter is NOT parsed here: `Bun.markdown`
 * does not read frontmatter — it is a renderer, and turns the opening `---`
 * into an `<hr>` and the metadata into an `<h2>`. Parsing belongs at runtime
 * anyway, since the files are read at runtime. `Bun.markdown.render()` is used
 * for one thing: flattening the first paragraph to plain text for the roster's
 * summary, which is a build-time convenience and nothing depends on it.
 */
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SOURCE = join(ROOT, 'agents')
const TARGET = join(ROOT, 'public/agents')

await rm(TARGET, { recursive: true, force: true })
await mkdir(TARGET, { recursive: true })

const names = []
const summaries = []

for await (const relative of new Bun.Glob('*/**').scan({ cwd: SOURCE, onlyFiles: true })) {
  const text = await Bun.file(join(SOURCE, relative)).text()
  await Bun.write(join(TARGET, relative), text)

  if (!relative.endsWith('/agent.md')) continue
  const name = dirname(relative)
  names.push(name)

  const body = text.startsWith('---') ? text.slice(text.indexOf('\n---') + 4) : text
  const [paragraph = ''] = body.trim().split('\n\n')
  summaries.push(
    `  ${name}: ${Bun.markdown.render(paragraph).replace(/\s+/g, ' ').trim().slice(0, 70)}`,
  )
}

names.sort()
await Bun.write(join(TARGET, 'index.json'), `${JSON.stringify({ agents: names }, null, 2)}\n`)

console.log(`agents -> public/agents/ : ${names.length ? names.join(', ') : '(none)'}`)
for (const line of summaries) console.log(line)
if (names.length === 0) {
  console.log('  note: no agents were found under agents/; the app will have nothing to talk to')
}
