/** Browser transport compatibility for anonymous public npm downloads. */
const npmMetadataHeaders = ['npm-auth-type', 'npm-command', 'npm-session', 'pacote-pkg-id', 'pacote-req-type', 'pacote-version', 'pacote-integrity']

export function browserRequestOptions(address, options = {}) {
  const url = new URL(address)
  const headers = new Headers(options.headers)
  const method = String(options.method ?? 'GET').toUpperCase()
  // These optional client metadata fields trigger an unsupported registry CORS
  // preflight. pacote-integrity is an outgoing annotation; npm still verifies
  // the downloaded archive locally using its separate integrity option.
  // Never rewrite authentication, scoped/private package requests,
  // writes, or a caller's custom headers to conceal a missing CORS permission.
  if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password ||
      !['GET', 'HEAD'].includes(method) || /^\/(?:@|%40)/i.test(url.pathname) ||
      ['authorization', 'proxy-authorization', 'cookie'].some((name) => headers.has(name))) return options
  if (!npmMetadataHeaders.some((name) => headers.has(name))) return options
  for (const name of npmMetadataHeaders) headers.delete(name)
  return { ...options, headers }
}
