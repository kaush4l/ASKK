// HTTP helpers shared by the host API and its capabilities.
//
//   throw new HttpError(404, "Not found.")   an error the host API answers with that status
//   httpError(403, "…")                      the same, as an expression
//   json(status, body)                       a no-store JSON Response

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const httpError = (status, message) => new HttpError(status, message)

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
