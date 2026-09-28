/**
 * Built-in `files` — a workspace inside the browser, for when no host bridge is paired.
 *
 * Kept by the hub in IndexedDB, shared by every agent in this tab. Each file carries a revision;
 * a write may name the revision it read (`expect`), and the hub refuses it if someone wrote in
 * between, in one transaction, so parallel agents cannot silently overwrite each other.
 *
 * These are not the owner's files. Those are reached through the `host` tools.
 */

export const files_list = {
  description: 'List files in the browser workspace, optionally under a folder prefix.',
  parameters: { prefix: 'string (optional)' },
  risk: 'read',
  repeatable: true,
  run: async ({ prefix = '' }, ctx) => {
    const listed = await ctx.request('files.list', { prefix })
    return listed.length ? listed.map((file) => `${file.path}  (rev ${file.rev}, ${file.size} chars)`).join('\n') : '(no files)'
  },
}

export const files_read = {
  description: 'Read a file from the browser workspace. The answer starts with its revision.',
  parameters: { path: 'string' },
  risk: 'read',
  repeatable: true,
  run: async ({ path }, ctx) => {
    const file = await ctx.request('files.read', { path })
    return file ? `rev ${file.rev}\n${file.content}` : `no file at ${path}`
  },
}

export const files_write = {
  description: 'Write a whole file in the browser workspace. Pass expect with the revision you read to refuse a lost update.',
  parameters: { path: 'string', content: 'string', expect: 'revision number (optional)' },
  risk: 'write',
  writes: true,
  run: async ({ path, content, expect }, ctx) => {
    const result = await ctx.request('files.write', { path, content: String(content ?? ''), expect })
    return result.conflict ? `not written: ${path} is at rev ${result.rev}, not ${expect}. Read it again, then write.` : `wrote ${path} (rev ${result.rev})`
  },
}
