/** Pure capability validation shared by transport and presentation. No probing or grants. */
export function validModelRelayContract(scope) {
  return Boolean(scope && scope.version === 1 && scope.endpoint === '/model/fetch'
    && ['configured', 'scope-required'].includes(scope.status)
    && Array.isArray(scope.endpoints) && scope.endpoints.length <= 32
    && scope.endpoints.every(endpoint => {
      if (typeof endpoint !== 'string') return false
      try {
        const url = new URL(endpoint)
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      } catch { return false }
    }))
}

export function modelRelayIssue(host) {
  if (!host) return { message: 'The selected model relay is disconnected. Reconnect it before requesting inference.', code: 'relay_unavailable' }
  const grants = Array.isArray(host.capabilities) ? host.capabilities : []
  if (!grants.includes('model-relay') && !grants.includes('fetch')) return { message: 'This companion does not grant model-relay access.', code: 'relay_capability' }
  if (host.modelRelay != null) {
    if (!validModelRelayContract(host.modelRelay)) return { message: 'The companion returned an unsupported model relay contract. Update or reconnect the companion.', code: 'relay_capability' }
    if (!grants.includes('model-relay')) return { message: 'This companion does not grant model-relay access.', code: 'relay_capability' }
    if (host.modelRelay.status !== 'configured' || !host.modelRelay.endpoints.length) return { message: 'Configure the companion with --model-endpoint pointing to your provider API base, then reconnect it. Model access has not been granted to an endpoint.', code: 'relay_scope' }
  }
  return null
}

export const hasModelRelay = host => modelRelayIssue(host) === null
