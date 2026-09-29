import { hasModelRelay } from '../core/model-relay.js'

/** Labels describe recorded checks, never infer generation success from model listing. */
export function modelStatusLabel(model = {}) {
  if (model.status === 'checking') return model.check?.kind === 'reply' ? 'Testing reply…' : 'Listing models…'
  if (model.status === 'verified') return 'Reply verified'
  if (model.status === 'listed') return 'Model listed'
  if (model.status === 'failed') return 'Model check failed'
  return model.id || model.model ? 'Model configured' : 'Not configured'
}

export function modelDraftChanged(draft, saved = {}) {
  return Boolean(draft.key) || draft.baseUrl !== (saved.baseUrl || '') || draft.model !== (saved.id || saved.model || '') || draft.via !== (saved.via === 'bridge' ? 'bridge' : 'direct')
}

export function canCheckModel({ draft, saved, busy = false, active = false }) {
  return !busy && !active && saved?.status !== 'checking' && Boolean(draft.model.trim() && draft.baseUrl.trim()) && !modelDraftChanged(draft, saved)
}

export const modelCheckCancelled = error => error?.name === 'AbortError'

export const modelRelayAvailable = companion => companion?.status === 'connected' && hasModelRelay(companion)
