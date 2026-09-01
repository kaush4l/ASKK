# What the page can actually reach

Measured 2026-09-01. Everything below is the output of a command that is written
beside it. Nothing here is inferred, and the two beliefs this repository already
held about search endpoints were both wrong when checked.

This exists so the next person does not repeat it. The endpoints move: a row
that says `*` today is a row to re-run, not a row to trust.

## 1. Why this document has to exist

Root constraint **C2**. A page has `fetch`; it does not have permission. It may
read a response only from an origin that chooses to say so, in a header, on that
response. This is not a limit of the sandbox, of the worker, or of the static
host — it is the same-origin policy, and it is what actually bounds *"can the
agent find things out"*.

So "is there a search API" is the wrong question. The question is "is there a
search API **that sends `access-control-allow-origin`**", and it has a different
answer.

## 2. The probe

    curl -s -i '<url>' -H 'Origin: https://example.com'
    curl -s -i -X OPTIONS '<url>' -H 'Origin: https://example.com' \
         -H 'Access-Control-Request-Method: POST' \
         -H 'Access-Control-Request-Headers: content-type'

The GET is the decisive one for a search or a fetch: a `GET` with no custom
request headers is a *simple request* and is never preflighted, so the header on
the response is the whole story. The `OPTIONS` matters only for the one endpoint
below that needs `POST` with a JSON content type.

`STATUS` is the response status. `ALLOW-ORIGIN` is the value of
`access-control-allow-origin`, and `NONE` means the header was absent — which
means a browser cannot read that response no matter what its status was.

| Endpoint | STATUS | ALLOW-ORIGIN |
|---|---|---|
| DuckDuckGo html — `html.duckduckgo.com/html/?q=` | 403 | `NONE` |
| DuckDuckGo lite — `lite.duckduckgo.com/lite/?q=` | 403 | `NONE` |
| DuckDuckGo autocomplete — `duckduckgo.com/ac/` | 200 | `NONE` |
| DuckDuckGo Instant Answer — `api.duckduckgo.com` | 202 | `*` |
| Mojeek — `www.mojeek.com/search` | 403 | `*` |
| Qwant — `api.qwant.com/v3/search/web` | 403 | `https://example.com` |
| Brave, no key — `api.search.brave.com` | 422 | `NONE` |
| SearXNG — `searx.be/search?format=json` | 200 | `NONE` |
| SearXNG — `priv.au/search?format=json` | 429 | `NONE` |
| Marginalia — `old-search.marginalia.nu` | 200 | `NONE` |
| r.jina.ai — `r.jina.ai/<url>` | 401 | `https://example.com` |
| **Firecrawl — `api.firecrawl.dev/v1/search` (POST)** | **200** | **`*`** |
| Wikipedia REST summary | 200 | `*` |
| Wikipedia REST search — `w/rest.php/v1/search/page` | 200 | `*` |
| Wikipedia `w/api.php` (no `origin`) | 200 | `NONE` |
| Wikipedia `w/api.php&origin=*` | 200 | `*` |
| Wikidata `w/api.php&origin=*` | 200 | `*` |
| Hacker News — `hn.algolia.com/api/v1/search` | 200 | `https://example.com` |
| Stack Exchange — `api.stackexchange.com/2.3` | 200 | `*` |
| GitHub API — `api.github.com` | 200 | `*` |
| GitHub raw — `raw.githubusercontent.com` | 200 | `*` |
| npm registry | 200 | `*` |
| PyPI — `pypi.org/pypi/<name>/json` | 200 | `*` |
| crates.io — `crates.io/api/v1` | 403 | `NONE` |
| jsDelivr | 200 | `*` |
| unpkg | 200 | `*` |
| OpenAlex | 200 | `*` |
| Crossref | 200 | `*` |
| endoflife.date | 200 | `*` |
| docs.rs | 200 | `NONE` |
| MDN | 200 | `NONE` |
| ziglang.org | 200 | `NONE` |

Four things this table says that are worth saying in words.

**No general web search survives except one.** DuckDuckGo blocks both scraping
endpoints outright, Mojeek returns 403 to a datacentre address, Qwant serves a
captcha, Brave wants a subscription token, and the two public SearXNG instances
answer HTML or 429 rather than the JSON their `format=json` asks for. The single
keyless general search that both answers and permits a browser to read the
answer is Firecrawl's, and it is what `SearchTool` uses.

**A 200 with no header is not a success.** `docs.rs`, MDN, `ziglang.org` and
Marginalia all answer 200 to `curl` and are unreadable from a page. Anyone
testing an endpoint with `curl` and no `Origin` header will conclude the
opposite, and that is the mistake this document is here to stop.

**Two beliefs recorded in this project's own memory were false and are now
measured false again.** `r.jina.ai` keyless is *not* available: its CORS is
fine, and it answers **401** — `AuthenticationRequiredError: You have been
blocked from performing anonymous queries due to bad network reputation
(AS7922)` — which is a consumer ISP, exactly where a browser agent lives. Public
SearXNG is not a fallback either.

**Wikimedia needs `&origin=*` on `w/api.php` and nothing on the REST paths.**
Same host, same query, one parameter, and the difference is whether a page may
read it at all:

    $ curl -s -i '…/w/api.php?action=query&list=search&srsearch=zig&format=json' \
        -H 'Origin: https://example.com' | grep -i access-control
    (nothing)

    $ curl -s -i '…&origin=*' -H 'Origin: https://example.com' | grep -i access-control
    access-control-allow-origin: *
    access-control-allow-credentials: false
    access-control-expose-headers: MediaWiki-API-Error, Retry-After, X-Database-Lag, …

## 3. `DOMParser` is not in a worker

Checked rather than assumed, because a fetch tool that reduces HTML with a DOM
would pass every test written in a page and be `undefined` in the realm that
runs it. A module worker was started from a served page and asked what it has:

    worker: { realm: "worker", DOMParser: "undefined", document: "undefined",
              fetch: "function", AbortController: "function",
              TextDecoder: "function", Response: "function",
              ReadableStream: "function" }
    page:   { DOMParser: "function", document: "object" }

Chrome, `--headless=new`. `DOMParser` is `[Exposed=Window]` and a worker is not
a Window, so this is a property of the platform rather than of the build.
`src/core/tools/readable.js` is the consequence: the reduction is written by
hand, with no DOM and no dependency.

Safari is unmeasured here and therefore `unverified`, not `have`.

## 4. A browser cannot see why `fetch` failed — so it has to ask twice

This is the finding that shaped `FetchTool`. A CORS refusal, a dead host and a
DNS failure are the *same* rejection, with no detail in it:

    TypeError: Failed to fetch

The agent's correct next move is completely different for each — one is
permanent and one is worth a retry — so the difference has to be established. It
can be. An origin that merely will not let a page *read* it still answers a
`no-cors` request, opaquely; a host that is not there rejects that too. Run in a
module worker, same conditions, same code:

| url | `fetch(url)` | `fetch(url, {mode:'no-cors'})` |
|---|---|---|
| `raw.githubusercontent.com/…/README.md` | resolved 200, `type=cors` | — |
| `ziglang.org/` | REJECTED `TypeError: Failed to fetch` | **resolved `type=opaque`, status 0** |
| `askk-probe-no-such-host.invalid/` | REJECTED `TypeError: Failed to fetch` | **REJECTED `TypeError: Failed to fetch`** |
| `raw.githubusercontent.com/…/NO_SUCH_FILE` | resolved 404, `type=cors` | — |

One extra round trip, taken only on a path that has already failed, is what lets
the tool say *"that origin did not permit a browser to read it"* instead of
*"failed"*. The port in `src/backend/composition.js` does exactly this and
writes the answer into `blocked`.

## 5. The tools, run for real

The real adapter and the real tool classes, imported from `src/` into a module
worker and pointed at the live network — not a fake port:

| call | result |
|---|---|
| `search({"query": "zig programming language latest release"})` | 5 ranked results, **1,146 characters total** |
| `fetch` Wikipedia REST summary | `200`, 2,265 chars of JSON, passed through unreduced |
| `fetch` `raw.githubusercontent.com/…/README.md` | `200`, 123 chars |
| `fetch` `httpbin.org/html` | `200 · reduced from HTML`, 3,620 chars, no script or style text |
| `fetch` `ziglang.org/download/` | *"answered, but that origin did not permit a browser to read it — it sends no CORS header…"* |
| `fetch` `askk-probe-no-such-host.invalid/` | *"nothing answered at askk-probe-no-such-host.invalid…"* |
| `fetch` `…/NOPE` | `404` + the body |
| `fetch` jQuery 3.7.1 (285 KB) | `[cut: 8,000 of 285,313 characters shown]` |
| `fetch` three.js module (1.2 MB) | `[cut: 8,000 of 524,288 characters shown]` + `[the download stopped at 512 KB, so the page may be incomplete]` |

The last row is the one worth keeping: the two cuts are different facts and both
are stated, because a model told only that its text was truncated will ask for
the rest of a page that was never downloaded.

## 6. What is still `barred`, and what that costs

Most of the web. `docs.rs`, MDN and a project's own documentation site are all
unreadable from this page and always will be without something in the middle.
That is C2 working as designed, and the honest response is the one `FetchTool`
gives: name the constraint, and go somewhere that permits it — which for a
software agent is usually `raw.githubusercontent.com`, an API, or a package
registry, all of which permit it.

No CORS proxy is used. One would work, and `api.allorigins.win`,
`corsproxy.io` and `api.codetabs.com` were probed for it (522, 401 and 522
respectively on the day). It was rejected on design rather than on availability:
routing the user's reading through an unrelated third party, silently, to hide a
constraint the agent should be reasoning about is the wrong trade for this tree.

## 7. What `search` costs in trust, which is not nothing

The paragraph above rejects a CORS proxy because *"routing the user's reading
through an unrelated third party, silently, to hide a constraint the agent
should be reasoning about is the wrong trade"*. `search` is that same trade, and
this section exists because the previous version of this document made the
argument and then did not apply it to itself.

Every query the user asks leaves the browser, unauthenticated and unbatched, to
`api.firecrawl.dev`. There is no keyless search endpoint that avoids this — §2
is the measurement, and the answer was one endpoint, not a choice of them. And
Firecrawl's `description` field is not a search snippet: it is scraped page
content, measured at ~4 KB of a Codeberg page for one result on the probe run.
`search` is therefore a third-party read-proxy with a query log, and calling it
anything else would be dishonest.

Three things follow, and all three are done rather than argued:

1. `SEARCH_ENDPOINT` is exported from `src/core/tools/SearchTool.js` and
   `buildKernel` pushes a boot note naming its host, so the disclosure reaches
   the user through the same channel as *"no sandbox image is configured"*
   rather than living only in a comment.
2. `SearchTool` clips every `description` to 200 characters. That is a context
   budget first, but it is also the smallest amount of third-party page content
   that still lets the agent choose which URL to `fetch` itself.
3. `fetch` is not proxied, and must not become so. The agent reading a page
   directly is what makes *"that origin did not permit a browser to read it"* a
   true statement the agent can act on, and it is the only part of this that a
   third party is not already standing in the middle of.

The day this endpoint asks for a key, the honest replacement is a key from
settings, not a proxy: `SearchTool`'s constructor already takes an `endpoint`
override for exactly that.
