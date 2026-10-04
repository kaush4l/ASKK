// A bearer token from an OAuth token file another program also uses.
//
// An MCP url server may name `"oauth": "<file>"` (mcp.json; `${VAR}` reads the
// environment). The file is the one a browser authorization once wrote (the
// fastmcp layout: tokens.access_token / refresh_token, client.client_id,
// oauth_metadata.token_endpoint, absolute expires_at). There is one copy, never
// a duplicate: a refresh token rotates when it is used, so whichever copy
// refreshed second would be locked out. Every refresh runs under an exclusive
// flock on ".<file>.lock" beside it and re-reads the file inside the lock, the
// same protocol as the Python desk's broker.py, so both can share it.

import { closeSync, openSync } from "node:fs"
import { chmod, rename, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

const MARGIN = 600 // seconds: refresh this long before the access token dies
const LOCK_EX = 2
const LOCK_UN = 8

let libc = null
async function flock(fd, op) {
  if (!libc) {
    const { dlopen, FFIType } = await import("bun:ffi")
    libc = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    }).symbols
  }
  if (libc.flock(fd, op) !== 0) throw new Error("Cannot lock the OAuth token file.")
}

const read = async (file) => {
  const source = Bun.file(file)
  if (!(await source.exists())) throw new Error(`No OAuth authorization at ${file}; authorize it again in a browser.`)
  return JSON.parse(await source.text())
}

const fresh = (data, now = Date.now() / 1000) => (data.expires_at ?? 0) - now > MARGIN && data.tokens?.access_token

async function refresh(file) {
  const fd = openSync(join(dirname(file), `.${basename(file)}.lock`), "a", 0o600)
  try {
    await flock(fd, LOCK_EX)
    const data = await read(file) // inside the lock: another program may have refreshed
    if (fresh(data)) return data.tokens.access_token
    const token = data.tokens?.refresh_token
    const client = data.client?.client_id
    const endpoint = data.oauth_metadata?.token_endpoint
    if (!token || !client || !endpoint) throw new Error(`${file} cannot be refreshed (no refresh token, client id or token endpoint).`)
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: client }),
    })
    if (!response.ok) {
      // invalid_grant: the owner must authorize again. The body never holds the token.
      throw new Error(`The token endpoint refused to refresh (${response.status} ${(await response.text()).slice(0, 200)}).`)
    }
    const next = await response.json()
    next.refresh_token ??= token // RFC 6749 §6: omitted means unchanged
    next.scope ??= data.tokens?.scope
    data.tokens = next
    data.expires_at = Date.now() / 1000 + Number(next.expires_in || 0)
    const writing = file.replace(/(\.json)?$/, ".writing")
    await writeFile(writing, JSON.stringify(data, null, 2), { mode: 0o600 })
    await chmod(writing, 0o600)
    await rename(writing, file)
    return next.access_token
  } finally {
    await flock(fd, LOCK_UN).catch(() => {})
    closeSync(fd)
  }
}

// `${VAR}` from the environment.
export const expandEnv = (text) =>
  text.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
    if (!process.env[name]) throw new Error(`\${${name}} is not set (.env).`)
    return process.env[name]
  })

// Headers for one request: a valid access token, refreshed when due.
export async function oauthHeaders(file, { force = false } = {}) {
  const data = await read(file)
  const token = !force && fresh(data) ? data.tokens.access_token : await refresh(file)
  return { authorization: `Bearer ${token}` }
}
