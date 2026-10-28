// One call to the desk server's host API (/__askk/<endpoint>): a GET (with `params`) or a POST (with `body`) → the
// answer's JSON, else an Error saying why (with `status` when the server answered). The page clients — projects,
// proposals, the workspace — share it.

import { withBase } from "@/backend/live/base-path"

export async function hostApi(endpoint, { params, body } = {}) {
  let response
  try {
    response = await fetch(withBase(`/__askk/${endpoint}${params ? `?${new URLSearchParams(params)}` : ""}`), {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    })
  } catch {
    throw new Error("The desk server is not reachable.")
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw Object.assign(new Error(data?.error ?? `Request failed (${response.status}).`), { status: response.status })
  return data
}
