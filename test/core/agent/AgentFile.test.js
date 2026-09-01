import { describe, expect, test } from 'bun:test'
import { parseAgentFile, parseFrontmatter } from '../../../src/core/agent/AgentFile.js'

/**
 * The agent file is the only source of an agent's behaviour, and it is parsed
 * by a YAML subset written here rather than by a library. So the subset's edges
 * are the agent's edges: a list read as a string silently gives the agent no
 * tools, and a nested map read flat silently gives it no MCP server. Neither
 * raises anything — the agent simply turns up with less than its file says.
 *
 * The last test parses the real `agents/main/agent.md` from disk. That file is
 * the ugly input this parser was written for — a comment block, an inline list,
 * and a list of maps — and it is the one input that must never stop parsing,
 * because it is the agent the app opens with.
 */

describe('parseFrontmatter — scalars', () => {
  test('types are read, not left as strings', () => {
    const { data, notes } = parseFrontmatter(
      [
        'name: main',
        'quoted: "keep: this"',
        "single: 'also this'",
        'enabled: true',
        'disabled: false',
        'count: 12',
        'ratio: 0.75',
        'negative: -3',
        'nothing: null',
        'tilde: ~',
      ].join('\n'),
    )

    expect(data).toEqual({
      name: 'main',
      quoted: 'keep: this',
      single: 'also this',
      enabled: true,
      disabled: false,
      count: 12,
      ratio: 0.75,
      negative: -3,
      nothing: null,
      tilde: null,
    })
    expect(notes).toEqual([])
  })

  test('comments and blank lines are not settings', () => {
    const { data } = parseFrontmatter('# a comment\n\nname: main\n\n  # indented comment\n')

    expect(data).toEqual({ name: 'main' })
  })

  test('a line that is not a setting costs that line and is reported', () => {
    const { data, notes } = parseFrontmatter('name: main\njust some prose\nmodel: gemma', 'a.md')

    expect(data).toEqual({ name: 'main', model: 'gemma' })
    expect(notes).toEqual(['a.md: could not read frontmatter line 2 ("just some prose")'])
  })
})

describe('parseFrontmatter — lists', () => {
  test('an inline list is a list, and a one-item list is still a list', () => {
    const { data } = parseFrontmatter('tools: [shell, disk]\none: [shell]\nnone: []')

    expect(data.tools).toEqual(['shell', 'disk'])
    expect(data.one).toEqual(['shell'])
    expect(data.none).toEqual([])
  })

  test('an inline list splits on top-level commas only', () => {
    const { data } = parseFrontmatter('prompt: [identity, shell({"a": 1, "b": 2}), cue]')

    expect(data.prompt).toEqual(['identity', 'shell({"a": 1, "b": 2})', 'cue'])
  })

  test('a block list is the same list written the other way', () => {
    const { data } = parseFrontmatter(['tools: ', '  - shell', '  - disk'].join('\n'))

    expect(data.tools).toEqual(['shell', 'disk'])
  })

  test('a key with nothing under it is an empty list, not undefined', () => {
    // An unfinished `tools:` means the agent has no tools, which is a reading
    // that costs nothing.
    const { data } = parseFrontmatter('tools:\nname: main')

    expect(data.tools).toEqual([])
    expect(data.name).toBe('main')
  })

  test('an absent field is absent — it is not an empty string', () => {
    const { data } = parseFrontmatter('name: main')

    expect('model' in data).toBe(false)
    expect(data.model).toBeUndefined()
    expect(Object.keys(data)).toEqual(['name'])
  })
})

describe('parseFrontmatter — nesting', () => {
  test('a nested map is a map', () => {
    const { data } = parseFrontmatter(['env:', '  TZ: UTC', '  DEBUG: false'].join('\n'))

    expect(data.env).toEqual({ TZ: 'UTC', DEBUG: false })
  })

  test('a list of maps keeps every key of every entry', () => {
    const { data, notes } = parseFrontmatter(
      [
        'mcp:',
        '  - name: host',
        '    command: mcp-disk',
        '    args: [--verbose]',
        '    env:',
        '      TZ: UTC',
        '    include_tools: [disk]',
        '  - name: remote',
        '    url: https://example.test/mcp',
      ].join('\n'),
    )

    expect(notes).toEqual([])
    expect(data.mcp).toEqual([
      {
        name: 'host',
        command: 'mcp-disk',
        args: ['--verbose'],
        env: { TZ: 'UTC' },
        include_tools: ['disk'],
      },
      { name: 'remote', url: 'https://example.test/mcp' },
    ])
  })

  test('a setting after a nested block belongs to the outer map again', () => {
    const { data } = parseFrontmatter(
      ['mcp:', '  - name: host', '    command: mcp-disk', 'tools: [shell]'].join('\n'),
    )

    expect(data.tools).toEqual(['shell'])
    expect(data.mcp).toHaveLength(1)
  })
})

describe('parseAgentFile', () => {
  test('frontmatter and body are split at the closing marker', () => {
    const { metadata, body, notes } = parseAgentFile(
      ['---', 'name: main', 'tools: [shell]', '---', '', 'You are a careful assistant.', ''].join(
        '\n',
      ),
    )

    expect(metadata).toEqual({ name: 'main', tools: ['shell'] })
    expect(body).toBe('You are a careful assistant.')
    expect(notes).toEqual([])
  })

  test('--- inside a VALUE is not the closing marker; only one starting a line is', () => {
    // The discriminating case for the `'\n---'` anchor. Read as a bare `'---'`
    // the frontmatter closes in the middle of `desc`, which is then the string
    // 'a', `name` is never read at all, and the rest of the settings are served
    // to the model as instructions. Nothing raises; the agent is simply wrong.
    const { metadata, body, notes } = parseAgentFile(
      ['---', 'desc: a --- b', 'name: main', '---', '', 'the body'].join('\n'),
    )

    expect(metadata).toEqual({ desc: 'a --- b', name: 'main' })
    expect(body).toBe('the body')
    expect(notes).toEqual([])
  })

  test('a rule inside the body is not mistaken for the closing marker', () => {
    const { body } = parseAgentFile(
      ['---', 'name: main', '---', 'first paragraph', '', '---', '', 'second paragraph'].join('\n'),
    )

    expect(body).toBe('first paragraph\n\n---\n\nsecond paragraph')
  })

  test('no frontmatter at all is a valid agent that is all instructions', () => {
    const { metadata, body, notes } = parseAgentFile('You are helpful.', 'a.md')

    expect(metadata).toEqual({})
    expect(body).toBe('You are helpful.')
    expect(notes).toEqual(['a.md: no frontmatter; the whole file is treated as instructions'])
  })

  test('frontmatter that is never closed keeps the instructions', () => {
    const { metadata, body, notes } = parseAgentFile('---\nname: main\nYou are helpful.', 'a.md')

    expect(metadata).toEqual({})
    // Nothing is lost: the whole file, marker and all, becomes the body.
    expect(body).toBe('---\nname: main\nYou are helpful.')
    expect(notes[0]).toContain('frontmatter was never closed')
  })

  test('an empty file is an empty agent rather than a failure', () => {
    expect(parseAgentFile('').body).toBe('')
    expect(parseAgentFile(null).metadata).toEqual({})
  })
})

describe('the real agents/main/agent.md', () => {
  test('parses with no unread lines, and yields the tools and server it declares', async () => {
    const text = await Bun.file(new URL('../../../agents/main/agent.md', import.meta.url)).text()

    const { metadata, body, notes } = parseAgentFile(text, 'agents/main/agent.md')

    // Every line was read: no note here is also what proves the comment block
    // above `mcp:` produced no settings, since an unread line is reported.
    expect(notes).toEqual([])
    expect(metadata.name).toBe('main')
    // SHAPES, not contents. Adding a setting to the agent file is a content
    // edit and must not turn a parser test red — what must hold is that a list
    // arrives as a list and a server as a map, because either read flatly
    // costs the agent its tools or its server with nothing raised.
    expect(metadata.tools.every((name) => typeof name === 'string')).toBe(true)
    expect(metadata.tools.length).toBeGreaterThan(0)
    // The hardest shape in the file: a block sequence of maps, one of whose
    // values is an inline list.
    const [server] = metadata.mcp
    expect(typeof server.name).toBe('string')
    expect(typeof server.command).toBe('string')
    expect(Array.isArray(server.include_tools)).toBe(true)
    expect(body).toStartWith('You are a careful, direct assistant')
  })
})
