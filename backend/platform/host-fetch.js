// Requests to the local host API (/__askk/, companion/server/host-api.js),
// shared by every feature that calls it: GET with `params`, POST with a JSON
// `body`, never cached. An unreachable host becomes one plain error; an abort
// stays an abort.

import { withBase } from "@/backend/platform/base-path"

// The raw Response (for streams and status checks).
export async function hostFetch(endpoint, { params, body, signal } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : ""
  try {
    return await fetch(withBase(`/__askk/${endpoint}${query}`), {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error("The ASKK companion is not reachable.")
  }
}

// The JSON reply; a failed request throws the host's error, else
// "<label> request failed (<status>)". `onError(response, data)` may throw
// a more specific error first (e.g. a 409 conflict).
export async function hostRequest(endpoint, { label = "Companion", onError, ...options } = {}) {
  const response = await hostFetch(endpoint, options)
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    onError?.(response, data)
    throw new Error(data?.error ?? `${label} request failed (${response.status}).`)
  }
  return data
}
