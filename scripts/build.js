#!/usr/bin/env node
/**
 * Build the static site into dist/: copy, list, stamp. Nothing is compiled or bundled.
 *
 *     node scripts/build.js
 *
 * dist/ is index.html + src/ + everything in public/ + agents/index.json (the listing) +
 * .nojekyll (so GitHub Pages serves folders that start with an underscore). Every URL in the
 * page is relative, so dist/ works at a domain root or under any subpath.
 */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { listing } from './listing.js'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })
await cp(join(ROOT, 'public'), DIST, { recursive: true })
await cp(join(ROOT, 'src'), join(DIST, 'src'), { recursive: true })
await cp(join(ROOT, 'index.html'), join(DIST, 'index.html'))
const index = await listing(join(ROOT, 'public'))
await writeFile(join(DIST, 'agents/index.json'), `${JSON.stringify(index, null, 2)}\n`)
await writeFile(join(DIST, '.nojekyll'), '')
const agents = Object.keys(index.files).filter((file) => file.endsWith('/agent.md')).length
console.log(`dist/ built: ${Object.keys(index.files).length} published files, ${agents} agents, build ${index.build}`)
