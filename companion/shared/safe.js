// try/catch as an expression: fn()'s value, else `fallback` when it throws (a best-effort step that must not stop the caller).
export function attempt(fn, fallback = null) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

// Removes a file, said by nobody when it fails (a temp file already gone).
export const unlink = (file) => Bun.file(file).delete().catch(() => {})
