/**
 * Settings (`#/settings`, UX U9): ModelSection + OverrideList, BridgeSection,
 * PermissionsSection, DataSection. One page, four headings, no tabs.
 *
 * Text fields commit on blur or Enter and show `not saved` while edited; selects and checkboxes
 * commit at once. Catalogue entries are saved whole and in camelCase, because a saved entry
 * replaces the file's entry of the same alias.
 */

import { entry } from '../core/models.js'
import { add, download, h, twoPress } from './dom.js'
import { clock, duration, moment } from './time.js'

const PROVIDERS = [
  ['openai', 'OpenAI-compatible'],
  ['anthropic', 'Anthropic'],
  ['cli', 'Model CLI on your machine'],
  ['scripted', 'Scripted (demo)'],
]
const CLIS = ['claude', 'codex', 'gemini']
const RISKS = ['read', 'net', 'write', 'exec']
const TOOLS_BY_CAPABILITY = { exec: ['host_exec'], fs: ['host_read', 'host_write', 'host_list'], fetch: ['host_fetch'] }
const GUARDRAILS = ['rm -rf / or ~', 'sudo · doas', 'curl … | sh', 'mkfs · dd of=/dev/…', 'fork bombs', 'git push --force', 'writes outside the bridge root']

const ellipsize = (text, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export function mountSettings(el, state) {
  const hub = state.hub
  const root = h('section', { class: 'view settings', testid: 'settings' })
  add(el, root)
  let refreshing = false
  let pairError = ''
  let dataNote = ''
  let showKey = false
  let mcpBusy = false
  const mcpForm = { name: '', url: '', headers: '', error: '' }
  const drafts = new Map() // field id → uncommitted text

  // ─── helpers ───────────────────────────────────────────────────────────────
  const catalogue = () => hub.settings.get().catalogue
  const currentAlias = () => catalogue().default
  const currentEntry = () => entry(catalogue().models?.[currentAlias()] ?? {})

  async function saveEntry(alias, patch) {
    const settings = hub.settings.get()
    const saved = structuredClone(settings.saved ?? {})
    saved.models = saved.models ?? {}
    const merged = { ...entry(settings.catalogue.models?.[alias] ?? {}), ...patch }
    for (const [key, value] of Object.entries(patch)) if (value === '' || value == null) delete merged[key]
    saved.models[alias] = merged
    await hub.settings.set({ catalogue: saved })
  }

  async function saveDefault(alias) {
    const saved = structuredClone(hub.settings.get().saved ?? {})
    saved.default = alias
    await hub.settings.set({ catalogue: saved })
  }

  /** A text field that commits on blur or Enter, marked `not saved` while edited. */
  function textField(id, label, value, commit, { type = 'text', placeholder = '', multiline = false } = {}) {
    const input = multiline ? h('textarea', { class: 'field full', rows: 3, id }) : h('input', { type, class: 'field full', id, placeholder, autocomplete: 'off', spellcheck: 'false' })
    input.value = drafts.has(id) ? drafts.get(id) : value ?? ''
    const marker = h('span', { class: 'faint small', hidden: !drafts.has(id) }, 'not saved')
    input.disabled = !state.leader()
    input.addEventListener('input', () => {
      drafts.set(id, input.value)
      marker.hidden = input.value === (value ?? '')
    })
    const done = async () => {
      if (!drafts.has(id)) return
      const next = drafts.get(id)
      drafts.delete(id)
      marker.hidden = true
      if (next !== (value ?? '')) await commit(next)
    }
    input.addEventListener('blur', done)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !multiline) {
        event.preventDefault()
        done()
      }
    })
    return h('div', { class: 'form-row' }, h('label', { for: id }, label), h('div', { class: 'form-field' }, input, marker))
  }

  function failureWords(error, settings) {
    const text = String(error ?? '')
    const base = settings.baseUrl ?? ''
    if (/\b40[13]\b/.test(text)) return `${settings.provider === 'anthropic' ? 'Anthropic' : 'The provider'} refused the key for ${currentAlias()} (${/\b(40[13])\b/.exec(text)[1]}).`
    if (/Failed to fetch|NetworkError|Load failed|did not answer|fetch/i.test(text)) {
      if (location.protocol === 'https:' && /^http:\/\/(localhost|127\.)/.test(base) && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
        return 'Safari blocks this page from reaching http://localhost. Open the page from the bridge instead: bun host/bridge.js --serve dist, then http://127.0.0.1:7717/app/'
      }
      return `No answer from ${base || 'the server'}. If it is a local server, turn on its CORS setting (LM Studio) or set OLLAMA_ORIGINS (Ollama).`
    }
    return text
  }

  // ─── Model ─────────────────────────────────────────────────────────────────
  function modelSection() {
    const cat = catalogue()
    const alias = currentAlias()
    const current = currentEntry()
    const provider = current.provider ?? 'openai'
    const leader = state.leader()
    const out = h('section', { class: 'section', testid: 'model' }, h('h2', {}, 'Model'))

    // Default
    const select = h('select', { class: 'field', id: 'model-default', disabled: !leader })
    const aliases = Object.keys(cat.models ?? {})
    if (!state.mainModel()) add(select, h('option', { value: '' }, 'Choose a model'))
    for (const name of aliases) {
      const id = entry(cat.models[name]).model ?? ''
      add(select, h('option', { value: `alias:${name}`, selected: name === alias }, ellipsize(id ? `${name} (${id})` : name)))
    }
    const fetched = (state.models?.ids ?? []).filter((id) => !aliases.includes(id))
    if (fetched.length) {
      const group = h('optgroup', { label: `from ${alias}'s server` })
      for (const id of fetched) add(group, h('option', { value: `id:${id}` }, ellipsize(id)))
      add(select, group)
    }
    select.addEventListener('change', async () => {
      const value = select.value
      if (value.startsWith('alias:')) await saveDefault(value.slice(6))
      else if (value.startsWith('id:')) await saveEntry(alias, { model: value.slice(3) })
    })
    const refresh = h('button', { type: 'button', class: 'link', disabled: refreshing || !leader, testid: 'refresh-models' }, refreshing ? 'Refreshing…' : 'Refresh list')
    refresh.addEventListener('click', async () => {
      refreshing = true
      paint()
      state.models = await hub.models.refresh(alias)
      refreshing = false
      paint()
    })
    const found = state.models ? (state.models.error ? h('p', { class: 'bad small' }, failureWords(state.models.error, current)) : h('p', { class: 'faint small' }, `Found ${state.models.ids.length} models · ${clock(state.models.at)}`)) : null

    // Next step line
    const rows = state.manifest().filter((row) => !row.broken).sort((a, b) => a.path.localeCompare(b.path))
    const defaultId = current.model ?? ''
    const except = rows.filter((row) => row.pinned && (row.alias ? row.alias !== alias : row.model !== defaultId))
    const label = defaultId ? `${alias} (${defaultId})` : alias
    const next =
      !rows.length ? '' : except.length === rows.length ? `Next step uses ${label} on no thread — every agent overrides it` : except.length ? `Next step uses ${label} on every thread except ${except.map((row) => row.name).join(', ')}.` : `Next step uses ${label} on every thread.`

    add(out,
      h('div', { class: 'form-row' }, h('label', { for: 'model-default' }, 'Default'), h('div', { class: 'form-field' }, h('div', { class: 'row' }, select, refresh), found, next ? h('p', { class: 'dim small', testid: 'next-step' }, next) : null)),
    )

    // Provider
    const providerSelect = h('select', { class: 'field', id: 'model-provider', disabled: !leader }, PROVIDERS.map(([value, words]) => h('option', { value, selected: value === provider }, words)))
    providerSelect.addEventListener('change', () => saveEntry(alias, { provider: providerSelect.value }))
    add(out,
      h('div', { class: 'form-row' }, h('label', { for: 'model-provider' }, 'Provider'), h('div', { class: 'form-field' }, providerSelect, provider === 'openai' ? h('p', { class: 'faint small' }, 'Local servers use OpenAI-compatible with their localhost URL.') : null)),
    )

    if (provider === 'cli') {
      const cliSelect = h('select', { class: 'field', id: 'model-cli', disabled: !leader }, CLIS.map((name) => h('option', { value: name, selected: name === current.cli }, name)))
      cliSelect.addEventListener('change', () => saveEntry(alias, { cli: cliSelect.value }))
      add(out, h('div', { class: 'form-row' }, h('label', { for: 'model-cli' }, 'CLI'), h('div', { class: 'form-field' }, cliSelect, h('p', { class: 'faint small' }, 'Runs on your machine through the host bridge — pair it in Bridge.'))))
    }
    add(out, textField('model-id', 'Model', current.model ?? '', (value) => saveEntry(alias, { model: value.trim() })))
    if (provider !== 'cli' && provider !== 'scripted') {
      add(out, textField('model-base', 'Base URL', current.baseUrl ?? '', (value) => saveEntry(alias, { baseUrl: value.trim() }), { placeholder: 'http://127.0.0.1:1234/v1' }))
      let host = alias
      if (!cat.models?.[alias]) {
        try {
          host = new URL(current.baseUrl).host
        } catch {
          host = alias
        }
      }
      const keyRow = textField('model-key', `Key for ${host}`, current.apiKey ?? '', (value) => saveEntry(alias, { apiKey: value.trim() }), { type: showKey ? 'text' : 'password', placeholder: 'No key — fine for a local server' })
      const show = h('button', { type: 'button', class: 'link small' }, showKey ? 'Hide' : 'Show')
      show.addEventListener('click', () => {
        showKey = !showKey
        paint()
      })
      keyRow.querySelector('.form-field').append(show)
      add(out, keyRow)
      const headerText = Object.entries(current.headers ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')
      add(out,
        textField(
          'model-headers',
          'Extra headers',
          headerText,
          (value) => {
            const headers = {}
            for (const line of value.split('\n')) {
              const cut = line.indexOf(':')
              if (cut > 0) headers[line.slice(0, cut).trim()] = line.slice(cut + 1).trim()
            }
            return saveEntry(alias, { headers: Object.keys(headers).length ? headers : '' })
          },
          { multiline: true },
        ),
      )
    }
    add(out, textField('model-context', 'Context length', current.contextLength != null ? String(current.contextLength) : '', (value) => saveEntry(alias, { contextLength: value.trim() ? Number(value) : '' }), { type: 'number' }))
    if (hub.bridge.state().status === 'answering' && provider !== 'cli') {
      const via = h('input', { type: 'checkbox', id: 'model-via', checked: current.via === 'bridge', disabled: !leader })
      via.addEventListener('change', () => saveEntry(alias, { via: via.checked ? 'bridge' : '' }))
      add(out, h('div', { class: 'form-row' }, h('span', {}), h('label', { class: 'check', for: 'model-via' }, via, ' Send model calls through the bridge')))
    }

    // Last call
    const last = state.lastCall
    add(out,
      h(
        'div',
        { class: 'form-row' },
        h('span', { class: 'label' }, 'Last call'),
        h('p', { class: 'small num', testid: 'last-call' }, last ? [`${last.agent} · `, h('span', { class: last.ok ? '' : 'bad' }, last.ok ? 'ok' : `failed: ${last.error}`), ` · ${duration(last.seconds)} · ${clock(last.at)}`] : 'No call yet. Ask main something to check it.'),
      ),
    )

    // Overrides
    const overrides = rows.filter((row) => row.pinned)
    if (overrides.length) {
      add(out,
        h(
          'div',
          { class: 'overrides', testid: 'overrides' },
          h('h3', {}, 'Agents that override this'),
          overrides.map((row) => h('p', { class: 'mono small override' }, h('span', { class: 'col' }, row.name), h('span', { class: 'col' }, row.alias ? `${row.alias} (${row.model})` : row.model), h('span', { class: 'faint' }, `agents/${row.path}/agent.md`))),
          h('p', { class: 'faint small' }, 'Overrides are set in each agent’s frontmatter.'),
        ),
      )
    }
    return out
  }

  // ─── Bridge ────────────────────────────────────────────────────────────────
  function bridgeSection() {
    const bridge = hub.bridge.state()
    const health = hub.bridgeState?.health ?? {}
    const leader = state.leader()
    const out = h('section', { class: 'section', testid: 'bridge' })
    const statusWords = bridge.status === 'answering' ? `answering since ${moment(bridge.since)}` : bridge.status === 'down' ? `down since ${moment(bridge.since)}` : 'not paired'
    add(out, h('div', { class: 'section-head' }, h('h2', {}, 'Bridge'), h('span', { class: bridge.status === 'down' ? 'bad small' : 'dim small' }, statusWords)))

    if (bridge.status === 'unpaired') {
      const command = 'bun host/bridge.js --root ~/work'
      const copy = h('button', { type: 'button', class: 'link small' }, 'Copy')
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(command)
          copy.textContent = 'Copied'
        } catch {
          copy.textContent = 'Could not copy'
        }
      })
      const url = h('input', { type: 'url', class: 'field full', id: 'bridge-url', value: drafts.get('bridge-url') ?? 'http://127.0.0.1:7717', disabled: !leader })
      const token = h('input', { type: 'password', class: 'field full', id: 'bridge-token', autocomplete: 'off', disabled: !leader })
      url.addEventListener('input', () => drafts.set('bridge-url', url.value))
      const pair = h('button', { type: 'button', class: 'primary', disabled: !leader, testid: 'pair' }, 'Pair')
      pair.addEventListener('click', async () => {
        pair.disabled = true
        pair.textContent = 'Pairing…'
        const result = await hub.bridge.pair(url.value.trim(), token.value.trim())
        pairError = result.status === 'answering' ? '' : bridgeWords(result.error, url.value)
        paint()
      })
      add(out,
        h('p', {}, 'The bridge lets agents run commands, read your files and fetch any page, from your own machine. Run it in a terminal:'),
        h('div', { class: 'command' }, h('pre', { class: 'mono-block' }, command), copy),
        h('div', { class: 'form-row' }, h('label', { for: 'bridge-url' }, 'URL'), h('div', { class: 'form-field' }, url)),
        h('div', { class: 'form-row' }, h('label', { for: 'bridge-token' }, 'Token'), h('div', { class: 'form-field' }, token, h('p', { class: 'faint small' }, '(printed by the bridge when it starts)'))),
        pair,
        pairError ? h('p', { class: 'bad small' }, pairError) : null,
        h('p', { class: 'dim small' }, 'A paired page can run commands as your user inside the root. Pair only a page you trust, and pick a root that holds nothing you would not let an agent change.'),
      )
      return out
    }

    const disconnect = h('button', { type: 'button', class: bridge.status === 'down' ? 'link' : '', disabled: !leader }, 'Disconnect')
    disconnect.addEventListener('click', () => hub.bridge.disconnect())
    if (bridge.status === 'answering') {
      const caps = bridge.capabilities ?? []
      const clis = health.clis ?? []
      const capWords = ['exec', 'fs', 'fetch', 'cli'].map((cap) => {
        const on = caps.includes(cap)
        const name = cap === 'fs' ? 'files' : cap
        return h('span', { class: on ? '' : 'faint' }, `${name} ${on ? 'on' : 'off'}${cap === 'cli' && on && clis.length ? ` (${clis.join(', ')})` : ''}`)
      })
      const adds = Object.entries(TOOLS_BY_CAPABILITY).flatMap(([cap, tools]) => (caps.includes(cap) ? tools : []))
      add(out,
        h('p', { class: 'small num' }, `${health.name ?? 'harness-bridge'} ${bridge.version} · root ${bridge.root || '(hidden)'} · checked ${clock(state.bridgeChecked ?? bridge.since)}`),
        h('p', { class: 'small mono' }, capWords.flatMap((word, index) => (index ? [' · ', word] : [word]))),
        adds.length ? h('p', { class: 'small' }, `Adds ${adds.join(', ')}.`) : null,
        health.mcp?.length ? h('p', { class: 'small' }, `Runs MCP servers: ${health.mcp.join(', ')} (listed under MCP servers).`) : null,
        h('p', { class: 'dim small' }, state.bridgeRecovered ? `answering again since ${clock(state.bridgeRecovered)} · host tools return to each thread at its next idle restart` : 'Idle threads have them now; busy resident threads get them at their next idle restart.'),
        disconnect,
      )
    } else {
      const check = h('button', { type: 'button', class: 'primary', disabled: !leader }, 'Check now')
      check.addEventListener('click', async () => {
        check.textContent = 'Checking…'
        await hub.bridge.check()
        paint()
      })
      add(out,
        h('p', {}, `No answer from ${bridge.url}.`),
        bridge.error ? h('p', { class: 'dim small' }, bridgeWords(bridge.error, bridge.url)) : null,
        h('p', { class: 'dim small' }, 'Host tools leave at each thread’s next start. A call in flight will say so.'),
        h('div', { class: 'row' }, check, disconnect),
      )
    }
    return out
  }

  function bridgeWords(error, url) {
    const text = String(error ?? '')
    if (/token/i.test(text)) return 'The bridge refused the token. Copy it again from the terminal where the bridge is running.'
    if (/origin/i.test(text)) return `The bridge does not accept this page's origin. Start it with --allow-origin ${location.origin}.`
    if (/local network|private network/i.test(text)) return 'The browser was not allowed to reach your local network. Allow it in the site settings, then Refresh list.'
    if (/fetch|network|load failed/i.test(text)) return `No answer from ${url}.`
    return text
  }

  // ─── MCP servers ───────────────────────────────────────────────────────────
  function mcpSection() {
    let servers = []
    try {
      servers = hub.mcp.list()
    } catch {
      servers = []
    }
    const leader = state.leader()
    const configured = () => {
      try {
        return hub.mcp.configured()
      } catch {
        return {}
      }
    }
    const refresh = h('button', { type: 'button', class: 'link', disabled: !leader || mcpBusy, testid: 'mcp-refresh' }, mcpBusy ? 'Refreshing…' : 'Refresh')
    refresh.addEventListener('click', async () => {
      mcpBusy = true
      paint()
      await hub.mcp.refresh().catch(() => {})
      mcpBusy = false
      paint()
    })
    const out = h('section', { class: 'section', testid: 'mcp' }, h('div', { class: 'section-head' }, h('h2', {}, 'MCP servers'), refresh))
    add(out, h('p', { class: 'dim small' }, 'Tools from these servers reach agents that grant mcp. A server this page calls directly must answer CORS; the bridge can run stdio servers for you (bridge --mcp).'))
    if (!servers.length) add(out, h('p', { class: 'dim small' }, 'No servers yet.'))
    for (const server of servers) {
      const remove =
        server.from === 'bridge'
          ? h('span', { class: 'faint small' }, 'started by bridge --mcp')
          : h('button', { type: 'button', class: 'link small', disabled: !leader }, 'Remove')
      if (server.from !== 'bridge') {
        remove.addEventListener('click', async () => {
          const next = configured()
          delete next[server.name]
          await hub.mcp.set(next)
          paint()
        })
      }
      add(
        out,
        h(
          'div',
          { class: 'server', testid: 'mcp-server' },
          h('span', { class: 'mono' }, server.name),
          h('span', { class: server.status === 'down' ? 'bad small' : 'dim small' }, server.status),
          h('span', { class: 'dim small' }, `${server.tools?.length ?? 0} tools`),
          h('span', { class: 'faint small grow mono' }, server.url ?? ''),
          remove,
        ),
      )
      if (server.status === 'down' && server.error) add(out, h('p', { class: 'bad small' }, server.error))
    }
    const name = h('input', { type: 'text', class: 'field', id: 'mcp-name', placeholder: 'name', 'aria-label': 'Server name', disabled: !leader, spellcheck: 'false' })
    name.value = mcpForm.name
    name.addEventListener('input', () => (mcpForm.name = name.value))
    const url = h('input', { type: 'url', class: 'field full', id: 'mcp-url', placeholder: 'https://example.com/mcp', 'aria-label': 'Server URL', disabled: !leader, spellcheck: 'false' })
    url.value = mcpForm.url
    url.addEventListener('input', () => (mcpForm.url = url.value))
    const headers = h('textarea', { class: 'field full', rows: 2, id: 'mcp-headers', placeholder: 'Extra headers, one "key: value" per line (optional)', 'aria-label': 'Server headers', disabled: !leader })
    headers.value = mcpForm.headers
    headers.addEventListener('input', () => (mcpForm.headers = headers.value))
    const addButton = h('button', { type: 'button', class: 'primary', disabled: !leader }, 'Add server')
    addButton.addEventListener('click', async () => {
      const key = mcpForm.name.trim()
      if (!/^[A-Za-z0-9_-]+$/.test(key)) {
        mcpForm.error = 'A server name is letters, digits, - and _ only.'
        return paint()
      }
      if (!mcpForm.url.trim()) {
        mcpForm.error = 'A server needs a URL.'
        return paint()
      }
      const parsed = {}
      for (const line of mcpForm.headers.split('\n')) {
        const cut = line.indexOf(':')
        if (cut > 0) parsed[line.slice(0, cut).trim()] = line.slice(cut + 1).trim()
      }
      addButton.disabled = true
      addButton.textContent = 'Adding…'
      await hub.mcp.set({ ...configured(), [key]: { url: mcpForm.url.trim(), headers: parsed } })
      Object.assign(mcpForm, { name: '', url: '', headers: '', error: '' })
      paint()
    })
    add(out, h('div', { class: 'add-form' }, name, url, headers, addButton, mcpForm.error ? h('p', { class: 'bad small' }, mcpForm.error) : null))
    return out
  }

  // ─── Permissions ───────────────────────────────────────────────────────────
  function permissionsSection() {
    const policy = hub.settings.get().policy ?? {}
    const defaults = { read: 'allow', net: 'allow', write: 'ask', exec: 'ask', ...(policy.defaults ?? {}) }
    const leader = state.leader()
    const out = h('section', { class: 'section', testid: 'permissions' }, h('h2', {}, 'Permissions'), h('p', {}, 'When an agent calls a tool of this risk:'))
    for (const risk of RISKS) {
      const select = h('select', { class: 'field', id: `risk-${risk}`, disabled: !leader }, ['allow', 'ask', 'deny'].map((action) => h('option', { value: action, selected: defaults[risk] === action }, action)))
      select.addEventListener('change', () => hub.settings.set({ policy: { ...policy, defaults: { ...defaults, [risk]: select.value } } }))
      add(out, h('div', { class: 'form-row risk-row' }, h('label', { for: `risk-${risk}`, class: 'mono' }, risk), select))
      if ((risk === 'write' || risk === 'exec') && defaults[risk] === 'allow') {
        add(out, h('p', { class: 'bad small' }, risk === 'exec' ? 'exec: allow — every agent without its own rule runs commands without asking.' : 'write: allow — every agent without its own rule changes files without asking.'))
      }
    }
    add(out, h('p', { class: 'dim small' }, 'An agent’s permissions: frontmatter overrides these. Team shows what each tool ends up with.'))
    const rules = Object.entries(policy.rules ?? {}).flatMap(([agent, map]) => Object.entries(map ?? {}).map(([tool, action]) => ({ agent, tool, action })))
    add(out, h('h3', {}, `Rules you added · ${rules.length}`))
    if (!rules.length) add(out, h('p', { class: 'dim small' }, 'No rules yet. Ticking "Always allow" on an approval adds one here.'))
    for (const rule of rules) {
      const remove = h('button', { type: 'button', class: 'link small', disabled: !leader }, 'Remove')
      remove.addEventListener('click', () => {
        const next = structuredClone(policy)
        delete next.rules[rule.agent][rule.tool]
        if (!Object.keys(next.rules[rule.agent]).length) delete next.rules[rule.agent]
        hub.settings.set({ policy: next })
      })
      add(out, h('p', { class: 'rule small' }, h('span', { class: 'mono col' }, rule.tool), h('span', { class: 'col' }, `for ${rule.agent === '*' ? 'every agent' : rule.agent}`), h('span', { class: 'col' }, rule.action), h('span', { class: 'faint' }, 'from an approval '), remove))
    }
    add(out, h('h3', {}, 'Always denied'), h('p', { class: 'mono small' }, GUARDRAILS.join('  ·  ')), h('p', { class: 'dim small' }, 'These are refused whatever the policy says. The refusal names the pattern.'))
    return out
  }

  // ─── Your data ─────────────────────────────────────────────────────────────
  function dataSection() {
    const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)
    const exportButton = h('button', { type: 'button', class: 'link', testid: 'export-data' }, 'Export (without your keys)')
    exportButton.addEventListener('click', async () => {
      try {
        download(`harness-data-${new Date().toISOString().slice(0, 10)}.json`, await hub.data.export())
        dataNote = ''
      } catch (error) {
        dataNote = `Could not export: ${error?.message ?? error}`
      }
      paint()
    })
    const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'import-file' })
    let chosen = null
    const replace = twoPress('Import and replace', 'Replace', async () => {
      if (!chosen) return
      try {
        await hub.data.import(JSON.parse(await chosen.text()))
        dataNote = `Imported ${chosen.name}.`
      } catch (error) {
        dataNote = `Could not import: ${error?.message ?? error}`
      }
      paint()
    }, { class: 'danger', hidden: true, disabled: !state.leader() })
    file.addEventListener('change', () => {
      chosen = file.files?.[0] ?? null
      replace.hidden = !chosen
    })
    const pick = h('label', { class: 'link', for: 'import-file' }, 'Import')
    const durable = state.boot.durable === false ? h('p', { class: 'bad small' }, `This browser is not keeping anything: ${state.boot.why || 'storage is unavailable'}. Nothing survives a reload.`) : null
    return h(
      'section',
      { class: 'section', testid: 'data' },
      h('h2', {}, 'Your data'),
      h('p', {}, 'Settings, rules, main’s history, the last 200 runs, memory and learned layers are kept in this browser.'),
      safari ? h('p', { class: 'dim small' }, 'Safari deletes them after 7 days without a visit.') : null,
      durable,
      h('div', { class: 'row' }, exportButton, pick, file, replace),
      dataNote ? h('p', { class: 'small dim' }, dataNote) : null,
    )
  }

  function paint() {
    const active = document.activeElement
    const focusId = active && root.contains(active) ? active.id : ''
    root.replaceChildren(h('h1', {}, 'Settings'), modelSection(), bridgeSection(), mcpSection(), permissionsSection(), dataSection())
    if (focusId) document.getElementById(focusId)?.focus()
  }

  const off = state.on((topics) => {
    if (topics.has('bridge')) state.bridgeChecked = Date.now()
    if (['settings', 'bridge', 'lock', 'boot', 'team', 'mcp'].some((topic) => topics.has(topic))) {
      // Never repaint under a field the owner is typing into.
      if (drafts.size && root.contains(document.activeElement)) return
      paint()
    }
  })
  paint()
  return () => {
    off()
    root.remove()
  }
}
