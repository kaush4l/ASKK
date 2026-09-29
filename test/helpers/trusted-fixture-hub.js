/**
 * Explicit legacy/trusted-extension fixture adapter, never used by the application.
 * These tests exercise low-level Hub/tool contracts, including executable tools
 * and deferred work which declarative owner packages deliberately cannot import.
 * Production package boot is covered separately by the shipped-package tests.
 */
import { Hub as RuntimeHub } from '../../src/runtime/hub.js'
import { agentPaths, loadIndex, loader, readSpec } from '../../src/core/folder.js'

export class Hub extends RuntimeHub {
  constructor(options = {}) {
    const { fixtureDefault = 'main', fixtureServices = { compaction: 'compactor', retrospective: 'dreamer' }, ...runtime } = options
    super(runtime)
    this.fixtureDefault = fixtureDefault
    this.fixtureServices = fixtureServices
  }
  async readFolders() {
    this.index = await loadIndex(this.base, this.fetch)
    const load = loader(this.base, this.index, this.fetch)
    try { this.fileCatalogue = JSON.parse(await load('models.json')) } catch { this.fileCatalogue = {} }
    const specs = await Promise.all(agentPaths(this.index).map(path => readSpec(path, { index: this.index, load })))
    this.specs = new Map(specs.map(spec => [spec.path, { ...spec, engine: { ...spec.engine, session: spec.engine.session ?? (spec.engine.remembers || spec.path === this.fixtureDefault ? 'agent' : 'task') }, services: {} }]))
    this.defaultAgent = this.fixtureDefault
    const lead = this.specs.get(this.defaultAgent)
    if (lead) lead.services = Object.fromEntries(Object.entries(this.fixtureServices).filter(([, path]) => this.specs.has(path)))
    this.failed.clear()
    await this.packages.restore()
  }
}
