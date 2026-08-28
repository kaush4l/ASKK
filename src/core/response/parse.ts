/**
 * Reading a model's reply — the TOON and JSON scanners.
 *
 * Neither scanner throws on shape, only on genuinely invalid JSON, and
 * `BaseResponse.parse` catches even that: an empty result means "this format
 * was not it" and the caller moves on to the next one. Nothing here is called
 * from anywhere else.
 *
 * Small local models decorate. `**Thinking:** text`, `- response: ...`,
 * `1. steps:` and a fenced JSON object buried in prose are all things the
 * shipped models actually wrote, and every rule below exists for one of them.
 */

import type { FieldSpec } from '@/core/response/base'

export function ltrimChars(text: string, chars: string): string {
  let i = 0
  while (i < text.length && chars.includes(text.charAt(i))) i += 1
  return text.slice(i)
}

/** Python's `str.strip(chars)`, which JavaScript's argument-less `trim` is not. */
export function trimChars(text: string, chars: string): string {
  const left = ltrimChars(text, chars)
  let end = left.length
  while (end > 0 && chars.includes(left.charAt(end - 1))) end -= 1
  return left.slice(0, end)
}

/** The bare word a model meant when it wrote ``**'Tool'**``. */
export function bareWord(value: string): string {
  return trimChars(value.trim(), '\'"`* ').toLowerCase()
}

/** Python's `splitlines`, which does not leave a phantom last line. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Split `a, b(c, d), e` on top-level commas only. */
export function splitItems(inner: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0
  for (const char of inner) {
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    if (char === ',' && depth === 0) {
      items.push(current.trim())
      current = ''
    } else current += char
  }
  if (current) items.push(current.trim())
  return items.filter((item) => item)
}

/** Coerce a field value to a list: `[a, b]`, or one item per line. */
export function asList(value: string): string[] {
  const text = value.trim()
  if (text.startsWith('[') && text.endsWith(']')) return splitItems(text.slice(1, -1).trim())
  if (!text) return []
  return splitLines(text)
    .filter((line) => line.trim())
    .map((line) => line.replace(/^\s*(\d+[.)]|[-*])\s*/, '').trim())
}

/** Find the first balanced `{ … }` in the text and read it. */
export function parseJson(fields: readonly FieldSpec[], text: string): Record<string, unknown> {
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i)
    if (char === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) return coerceJson(fields, JSON.parse(text.slice(start, i + 1)))
    }
  }
  return {}
}

function coerceJson(fields: readonly FieldSpec[], data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
  const known = new Map(fields.map((f) => [f.name, f]))
  const entries = Object.entries(data as Record<string, unknown>)
  if (!entries.some(([key]) => known.has(key))) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    // a model may write a list field as one string — coerce it
    const field = known.get(key)
    out[key] = field?.list === true && typeof value === 'string' ? asList(value) : value
  }
  return out
}

/** Two-pass parse: locate the field lines, then take everything up to the next one. */
export function parseToon(fields: readonly FieldSpec[], text: string): Record<string, unknown> {
  const lines = splitLines(text)
  const starts = fieldLines(fields, lines)
  const data: Record<string, unknown> = {}
  for (let i = 0; i < starts.length; i += 1) {
    const [start, name, firstLine] = starts[i] as [number, string, string]
    const next = starts[i + 1]
    const end = next ? next[0] : lines.length
    const block = (firstLine ? [firstLine] : []).concat(lines.slice(start + 1, end))
    const value = block.join('\n').trim()
    data[name] = fields.find((f) => f.name === name)?.list === true ? asList(value) : value
  }
  return data
}

function fieldLines(fields: readonly FieldSpec[], lines: readonly string[]): [number, string, string][] {
  const known = new Set(fields.map((f) => f.name))
  const starts: [number, string, string][] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    const at = line.indexOf(':')
    if (at < 0) continue
    const key = line.slice(0, at)
    let value = line.slice(at + 1)
    const cleaned = trimChars(key.replace(/^[\s\-*#\d.]+/, ''), '*` ').trim().toLowerCase()
    if (!known.has(cleaned)) continue
    // `**Thinking:** text` leaves the closing marker on the value — drop it,
    // but only when the key itself was decorated, so a real `*` bullet survives.
    if (/[*`]/.test(key)) value = ltrimChars(value, '*` ')
    starts.push([index, cleaned, value.trim()])
  }
  return starts
}
