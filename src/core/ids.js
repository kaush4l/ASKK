/**
 * Identity generation for domain entities.
 *
 * crypto.randomUUID exists in both the window and the worker, but only in a
 * secure context — and GitHub Pages is https, as is localhost, so both realms
 * this app runs in qualify. The fallback is here so a non-secure origin
 * degrades instead of throwing at construction time.
 */
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
