# coi-serviceworker spike

Self-contained demo proving that [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker)
can make a page **cross-origin isolated** (`crossOriginIsolated === true`, so
`SharedArrayBuffer` is constructable) when served from a host that **cannot set
response headers** — i.e. GitHub Pages, where ASKK is deployed.

Findings and the integration verdict live in
[`docs/spikes/coi-serviceworker.md`](../../docs/spikes/coi-serviceworker.md).

## Files

- `coi-serviceworker.js` — vendored **verbatim** from upstream v0.1.7 (MIT). Do
  not hand-edit; re-vendor to update. See `LICENSE.coi-serviceworker`.
- `index.html` — registers the SW, then displays `crossOriginIsolated`, the
  result of `new SharedArrayBuffer(8)`, and the SW state. Exposes the same data
  as JSON on `window.__coiResult` for automation.

## Run it (simulates gh-pages: NO COOP/COEP headers)

```sh
python3 -m http.server 8108 --directory experiments/coi
# or: npx http-server experiments/coi -p 8108 -c-1
```

Open <http://localhost:8108/>. `localhost` is a secure context, so the service
worker registers. On the **first** load the page is `NOT ISOLATED`; the SW then
reloads the page once automatically and it flips to `ISOLATED ✓`.

> The SW must be served from the **same origin** as the page. It cannot be a CDN
> URL. On gh-pages it lives next to `index.html` at the site root.
