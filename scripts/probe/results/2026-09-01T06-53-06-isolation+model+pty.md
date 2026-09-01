# probe run 2026-09-01T06:53:06.568Z

```
entry            bun scripts/probe/run.js isolation model pty --port=8821 --echo-port=8824
host             http://127.0.0.1:8821/   (roots: scripts/probe/page, public/sandbox)
echo endpoint    http://127.0.0.1:8824   (ACAO *, deliberately no CORP, records what it receives)
local model      http://127.0.0.1:8873
platform         darwin arm64, bun 1.4.0
git              cc7ce5c (working tree dirty)
sandbox.wasm     107054914 bytes at public/sandbox/sandbox.wasm
```

## isolation

establishes: cross-origin isolation, SharedArrayBuffer and a blocking Atomics.wait (page, worker, nested worker) on a host that sends no COOP/COEP, and the subresource price of turning it on
cannot say:  anything about https://kaush4l.github.io/ASKK/, Safari.app, iOS or Firefox — this is 127.0.0.1, a secure-context exemption, against a probe page and not the Next export

### isolation / chromium / coep:off

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = false
  first_paint_SAB_typeof = "undefined"
  sw = "skipped on purpose - BASELINE, no isolation"
  crossOriginIsolated = false
  controller = false
  SharedArrayBuffer = {"ok":false,"err":"ReferenceError: SharedArrayBuffer is not defined"}
  Atomics.wait = {"ok":false,"err":"no SAB: ReferenceError: SharedArrayBuffer is not defined"}
  fetch_cors openai      (no CORP, CORS) = {"arrived":true,"status":401,"type":"cors"}
  fetch_cors anthropic   (no CORP, CORS) = {"arrived":false,"err":"TypeError: Failed to fetch"}
  fetch_cors huggingface (no CORP, CORS) - transformers.js weights = {"arrived":true,"status":200,"type":"cors"}
  fetch_cors wikipedia   (no CORP, NO ACAO) - CORS control = {"arrived":false,"err":"TypeError: Failed to fetch"}
  fetch_nocors cdnjs  (HAS CORP: cross-origin) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors esm.sh (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors huggingface (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  script_tag cdnjs (HAS CORP) = {"loaded":true,"marked":"object"}
  stylesheet fonts.googleapis (HAS CORP) = {"loaded":true,"rules":"opaque:SecurityError"}
  img google favicon (HAS CORP) = {"loaded":true,"w":32}
  img python.org favicon (NO CORP) = {"loaded":true,"w":48}
  img developer.mozilla.org favicon (NO CORP) = {"loaded":true,"w":48}
  control_404 = {"status":404,"coep":null,"coop":null}
NESTED Atomics.wait (page->worker->worker): {"err":"outer onerror: Uncaught ReferenceError: SharedArrayBuffer is not defined"}
SW-SERVED SAME-ORIGIN HEADERS: {"status":200,"coep":null,"coop":null,"corp":null}
HARD RELOAD: nav_status=200 crossOriginIsolated=false sw_controller=false
COLD FIRST VISIT: isolated_at_first_load=false -> after_sw_install=false reloads_needed=0 navigations=1
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395b :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [pageerror] SharedArrayBuffer is not defined
  [requestfailed] http://127.0.0.1:8821/coi-serviceworker.js?probe=1788245589007 :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395b :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### isolation / chromium / coep:require-corp

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = true
  first_paint_SAB_typeof = "function"
  sw_registered = {"scope":"http://127.0.0.1:8821/"}
  crossOriginIsolated = true
  controller = true
  SharedArrayBuffer = {"ok":true,"byteLength":8}
  atomics_timeout-probe = {"phase":"timeout-probe","result":"timed-out","ms":60}
  atomics_blocking-probe = {"phase":"blocking-probe","result":"ok","ms":250}
  Atomics.wait = {"ok":true,"wake_ms":250,"main_thread_still_alive_ms":314}
  fetch_cors openai      (no CORP, CORS) = {"arrived":true,"status":401,"type":"cors"}
  fetch_cors anthropic   (no CORP, CORS) = {"arrived":false,"err":"TypeError: Failed to fetch"}
  fetch_cors huggingface (no CORP, CORS) - transformers.js weights = {"arrived":true,"status":200,"type":"cors"}
  fetch_cors wikipedia   (no CORP, NO ACAO) - CORS control = {"arrived":false,"err":"TypeError: Failed to fetch"}
  fetch_nocors cdnjs  (HAS CORP: cross-origin) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors esm.sh (NO CORP) = {"arrived":false,"err":"TypeError: Failed to fetch"}
  fetch_nocors huggingface (NO CORP) = {"arrived":false,"err":"TypeError: Failed to fetch"}
  script_tag cdnjs (HAS CORP) = {"loaded":true,"marked":"object"}
  stylesheet fonts.googleapis (HAS CORP) = {"loaded":true,"rules":"opaque:SecurityError"}
  img google favicon (HAS CORP) = {"loaded":true,"w":32}
  img python.org favicon (NO CORP) = {"loaded":false,"err":"onerror"}
  img developer.mozilla.org favicon (NO CORP) = {"loaded":false,"err":"onerror"}
  control_404 = {"status":404,"coep":"require-corp","coop":"same-origin"}
NESTED Atomics.wait (page->worker->worker): {"outer_coi":true,"outer_sab":"function","inner":{"inner_coi":true,"inner_sab":"function","atomics_wait":"ok","blocked_ms":197}}
SW-SERVED SAME-ORIGIN HEADERS: {"status":200,"coep":"require-corp","coop":"same-origin","corp":"same-origin"}
HARD RELOAD: nav_status=200 crossOriginIsolated=true sw_controller=true
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://esm.sh/marked@12.0.2 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://www.python.org/static/favicon.ico?x=1788245593107 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://developer.mozilla.org/favicon.ico?x=1788245593259 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [requestfailed] http://127.0.0.1:8821/coi-serviceworker.js?probe=1788245593856 :: net::ERR_ABORTED
DRIVER FAILED: evaluate: Execution context was destroyed, most likely because of a navigation
    at run (/Users/kaush/Downloads/Dev/ASKK/scripts/probe/drivers/isolation.mjs:105:28)
    at processTicksAndRejections (native:7:39)
```

### isolation / chromium / coep:credentialless

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = true
  first_paint_SAB_typeof = "function"
  sw_registered = {"scope":"http://127.0.0.1:8821/"}
  crossOriginIsolated = true
  controller = true
  SharedArrayBuffer = {"ok":true,"byteLength":8}
  atomics_timeout-probe = {"phase":"timeout-probe","result":"timed-out","ms":54}
  atomics_blocking-probe = {"phase":"blocking-probe","result":"ok","ms":251}
  Atomics.wait = {"ok":true,"wake_ms":251,"main_thread_still_alive_ms":308}
  fetch_cors openai      (no CORP, CORS) = {"arrived":true,"status":401,"type":"cors"}
  fetch_cors anthropic   (no CORP, CORS) = {"arrived":false,"err":"TypeError: Failed to fetch"}
  fetch_cors huggingface (no CORP, CORS) - transformers.js weights = {"arrived":true,"status":200,"type":"cors"}
  fetch_cors wikipedia   (no CORP, NO ACAO) - CORS control = {"arrived":false,"err":"TypeError: Failed to fetch"}
  fetch_nocors cdnjs  (HAS CORP: cross-origin) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors esm.sh (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors huggingface (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  script_tag cdnjs (HAS CORP) = {"loaded":true,"marked":"object"}
  stylesheet fonts.googleapis (HAS CORP) = {"loaded":true,"rules":"opaque:SecurityError"}
  img google favicon (HAS CORP) = {"loaded":true,"w":32}
  img python.org favicon (NO CORP) = {"loaded":true,"w":48}
  img developer.mozilla.org favicon (NO CORP) = {"loaded":true,"w":48}
  control_404 = {"status":404,"coep":"credentialless","coop":"same-origin"}
NESTED Atomics.wait (page->worker->worker): {"outer_coi":true,"outer_sab":"function","inner":{"inner_coi":true,"inner_sab":"function","atomics_wait":"ok","blocked_ms":208}}
SW-SERVED SAME-ORIGIN HEADERS: {"status":200,"coep":"credentialless","coop":"same-origin","corp":"same-origin"}
HARD RELOAD: nav_status=200 crossOriginIsolated=true sw_controller=true
COLD FIRST VISIT: isolated_at_first_load=false -> after_sw_install=true reloads_needed=1 navigations=2
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395b :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [requestfailed] http://127.0.0.1:8821/coi-serviceworker.js?probe=1788245597196 :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395b :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### isolation / webkit / coep:off

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = false
  first_paint_SAB_typeof = "undefined"
  sw = "skipped on purpose - BASELINE, no isolation"
  crossOriginIsolated = false
  controller = false
  SharedArrayBuffer = {"ok":false,"err":"ReferenceError: Can't find variable: SharedArrayBuffer"}
  Atomics.wait = {"ok":false,"err":"no SAB: ReferenceError: Can't find variable: SharedArrayBuffer"}
  fetch_cors openai      (no CORP, CORS) = {"arrived":true,"status":401,"type":"cors"}
  fetch_cors anthropic   (no CORP, CORS) = {"arrived":false,"err":"TypeError: Load failed"}
  fetch_cors huggingface (no CORP, CORS) - transformers.js weights = {"arrived":true,"status":200,"type":"cors"}
  fetch_cors wikipedia   (no CORP, NO ACAO) - CORS control = {"arrived":false,"err":"TypeError: Load failed"}
  fetch_nocors cdnjs  (HAS CORP: cross-origin) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors esm.sh (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors huggingface (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  script_tag cdnjs (HAS CORP) = {"loaded":true,"marked":"object"}
  stylesheet fonts.googleapis (HAS CORP) = {"loaded":true,"rules":"opaque:SecurityError"}
  img google favicon (HAS CORP) = {"loaded":true,"w":32}
  img python.org favicon (NO CORP) = {"loaded":true,"w":48}
  img developer.mozilla.org favicon (NO CORP) = {"loaded":true,"w":48}
  control_404 = {"status":404,"coep":null,"coop":null}
NESTED Atomics.wait (page->worker->worker): {"err":"outer onerror: ReferenceError: Can't find variable: SharedArrayBuffer"}
SW-SERVED SAME-ORIGIN HEADERS: {"status":200,"coep":null,"coop":null,"corp":null}
HARD RELOAD: nav_status=200 crossOriginIsolated=false sw_controller=false
COLD FIRST VISIT: isolated_at_first_load=false -> after_sw_install=false reloads_needed=0 navigations=1
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [pageerror] Can't find variable: SharedArrayBuffer
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### isolation / webkit / coep:require-corp

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = true
  first_paint_SAB_typeof = "function"
  sw_registered = {"scope":"http://127.0.0.1:8821/"}
  crossOriginIsolated = true
  controller = true
  SharedArrayBuffer = {"ok":true,"byteLength":8}
  atomics_timeout-probe = {"phase":"timeout-probe","result":"timed-out","ms":56}
  atomics_blocking-probe = {"phase":"blocking-probe","result":"ok","ms":252}
  Atomics.wait = {"ok":true,"wake_ms":252,"main_thread_still_alive_ms":312}
  fetch_cors openai      (no CORP, CORS) = {"arrived":true,"status":401,"type":"cors"}
  fetch_cors anthropic   (no CORP, CORS) = {"arrived":false,"err":"TypeError: Load failed"}
  fetch_cors huggingface (no CORP, CORS) - transformers.js weights = {"arrived":true,"status":200,"type":"cors"}
  fetch_cors wikipedia   (no CORP, NO ACAO) - CORS control = {"arrived":false,"err":"TypeError: Load failed"}
  fetch_nocors cdnjs  (HAS CORP: cross-origin) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors esm.sh (NO CORP) = {"arrived":false,"err":"TypeError: Load failed"}
  fetch_nocors huggingface (NO CORP) = {"arrived":false,"err":"TypeError: Load failed"}
  script_tag cdnjs (HAS CORP) = {"loaded":true,"marked":"object"}
  stylesheet fonts.googleapis (HAS CORP) = {"loaded":true,"rules":"opaque:SecurityError"}
  img google favicon (HAS CORP) = {"loaded":true,"w":32}
  img python.org favicon (NO CORP) = {"loaded":false,"err":"onerror"}
  img developer.mozilla.org favicon (NO CORP) = {"loaded":false,"err":"onerror"}
  control_404 = {"status":404,"coep":"require-corp","coop":"same-origin"}
NESTED Atomics.wait (page->worker->worker): {"outer_coi":true,"outer_sab":"function","inner":{"inner_coi":true,"inner_sab":"function","atomics_wait":"ok","blocked_ms":206}}
SW-SERVED SAME-ORIGIN HEADERS: {"status":200,"coep":"require-corp","coop":"same-origin","corp":"same-origin"}
HARD RELOAD: nav_status=200 crossOriginIsolated=true sw_controller=true
COLD FIRST VISIT: isolated_at_first_load=false -> after_sw_install=true reloads_needed=1 navigations=2
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /esm.sh/marked@12.0.2 due to access control checks.
  [requestfailed] https://esm.sh/marked@12.0.2 :: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json due to access control checks.
  [requestfailed] https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json :: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://www.python.org/static/favicon.ico?x=1788245606748 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://www.python.org/static/favicon.ico?x=1788245606748 due to access control checks.
  [requestfailed] https://www.python.org/static/favicon.ico?x=1788245606748 :: Cancelled load to https://www.python.org/static/favicon.ico?x=1788245606748 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://www.python.org/static/favicon.ico?x=1788245606748 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788245606877 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://developer.mozilla.org/favicon.ico?x=1788245606877 due to access control checks.
  [requestfailed] https://developer.mozilla.org/favicon.ico?x=1788245606877 :: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788245606877 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788245606877 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /esm.sh/marked@12.0.2 due to access control checks.
  [requestfailed] https://esm.sh/marked@12.0.2 :: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json due to access control checks.
  [requestfailed] https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json :: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://www.python.org/static/favicon.ico?x=1788245608583 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://www.python.org/static/favicon.ico?x=1788245608583 due to access control checks.
  [requestfailed] https://www.python.org/static/favicon.ico?x=1788245608583 :: Cancelled load to https://www.python.org/static/favicon.ico?x=1788245608583 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://www.python.org/static/favicon.ico?x=1788245608583 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788245608658 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://developer.mozilla.org/favicon.ico?x=1788245608658 due to access control checks.
  [requestfailed] https://developer.mozilla.org/favicon.ico?x=1788245608658 :: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788245608658 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788245608658 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### isolation / webkit / coep:credentialless

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = false
  first_paint_SAB_typeof = "undefined"
  sw_registered = {"scope":"http://127.0.0.1:8821/"}
  crossOriginIsolated = false
  controller = true
  SharedArrayBuffer = {"ok":false,"err":"ReferenceError: Can't find variable: SharedArrayBuffer"}
  Atomics.wait = {"ok":false,"err":"no SAB: ReferenceError: Can't find variable: SharedArrayBuffer"}
  fetch_cors openai      (no CORP, CORS) = {"arrived":true,"status":401,"type":"cors"}
  fetch_cors anthropic   (no CORP, CORS) = {"arrived":false,"err":"TypeError: Load failed"}
  fetch_cors huggingface (no CORP, CORS) - transformers.js weights = {"arrived":true,"status":200,"type":"cors"}
  fetch_cors wikipedia   (no CORP, NO ACAO) - CORS control = {"arrived":false,"err":"TypeError: Load failed"}
  fetch_nocors cdnjs  (HAS CORP: cross-origin) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors esm.sh (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  fetch_nocors huggingface (NO CORP) = {"arrived":true,"type":"opaque","status":0}
  script_tag cdnjs (HAS CORP) = {"loaded":true,"marked":"object"}
  stylesheet fonts.googleapis (HAS CORP) = {"loaded":true,"rules":"opaque:SecurityError"}
  img google favicon (HAS CORP) = {"loaded":true,"w":32}
  img python.org favicon (NO CORP) = {"loaded":true,"w":48}
  img developer.mozilla.org favicon (NO CORP) = {"loaded":true,"w":48}
  control_404 = {"status":404,"coep":"credentialless","coop":"same-origin"}
NESTED Atomics.wait (page->worker->worker): {"err":"outer onerror: ReferenceError: Can't find variable: SharedArrayBuffer"}
SW-SERVED SAME-ORIGIN HEADERS: {"status":200,"coep":"credentialless","coop":"same-origin","corp":"same-origin"}
HARD RELOAD: nav_status=200 crossOriginIsolated=false sw_controller=true
COLD FIRST VISIT: isolated_at_first_load=false -> after_sw_install=false reloads_needed=2 navigations=3
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [pageerror] Can't find variable: SharedArrayBuffer
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

## model

establishes: whether the app's real streaming model requests — the preflighted Anthropic POST, an OpenAI-compatible POST with and without a key, and a long local stream read to the last byte — arrive under each COEP mode, from the page and from a nested worker, with a server-side record of whether the CORS preflight was sent
cannot say:  anything about a VALID api key (every key here is deliberately invalid, so what is measured is arrival, not an answer), or about any host other than the three it calls

### model / chromium / coep:off

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"off"}
  [console] PROBE controls = {"control_404":{"status":404,"server_hdr_coep":null,"sw_synthesised_coep":null},"enforcement_nocorp_img":{"loaded":true,"w":48},"coi":false,"SAB":"undefined"}
crossOriginIsolated=false  SAB=undefined  reloads=0
ENFORCEMENT CONTROL (cross-origin no-CORP <img> python.org): {"loaded":true,"w":48}
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":246,"ms":246,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Failed to fetch"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":175,"ms":175,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":12,"frames":12,"bytes":2616,"text_len":5,"first_chunk_ms":6,"ms":3319,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":405,"frames":406,"bytes":86044,"text_len":3886,"first_chunk_ms":4,"ms":146738,"text_head":"\nWe need answer user's request: \"Write a detailed 600-word explanation of how a CPU cache "}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":5,"ms":840,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":false,"inner_coi":false,"inner_SAB":"undefined","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":12,"frames":12,"bytes":2617,"text_len":5,"first_chunk_ms":2,"ms":5649,"text_head":"\n\nOK."}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":405,"frames":406,"bytes":85732,"text_len":3729,"first_chunk_ms":7,"ms":121046,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":null}
----- CDP network events (preflights + blocks) -----
  {"k":"preflight-sent","url":"https://api.anthropic.com/v1/messages"}
  {"k":"preflight-resp","url":"https://api.anthropic.com/v1/messages","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"https://api.openai.com/v1/chat/completions"}
  {"k":"preflight-resp","url":"https://api.openai.com/v1/chat/completions","status":200,"corp":"(absent)","acao":"http://127.0.0.1:8821"}
  {"k":"loadingFailed","type":"Fetch","err":"net::ERR_FAILED","blockedReason":null,"corsError":"MissingAllowOriginHeader"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8873/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8873/v1/chat/completions","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8824/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8824/v1/chat/completions","status":204,"corp":"(absent)","acao":"(absent)"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### model / chromium / coep:require-corp

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"require-corp"}
  [console] PROBE reloading = {"attempt":1}
  [console] PROBE first_paint = {"coi":true,"SAB":"function","mode":"require-corp"}
  [console] PROBE controls = {"control_404":{"status":404,"server_hdr_coep":"require-corp","sw_synthesised_coep":"require-corp"},"enforcement_nocorp_img":{"loaded":false},"coi":true,"SAB":"function"}
crossOriginIsolated=true  SAB=function  reloads=1
ENFORCEMENT CONTROL (cross-origin no-CORP <img> python.org): {"loaded":false}
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":243,"ms":243,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Failed to fetch"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":230,"ms":231,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":17,"frames":17,"bytes":3613,"text_len":5,"first_chunk_ms":6,"ms":4210,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":378,"frames":377,"bytes":80087,"text_len":3689,"first_chunk_ms":3,"ms":60610,"text_head":"\nWe need respond to user: \"Write a detailed 600-word explanation of how a CPU cache works."}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":3,"ms":837,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":true,"inner_coi":true,"inner_SAB":"function","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":16,"frames":16,"bytes":3429,"text_len":4,"first_chunk_ms":2,"ms":4313,"text_head":"\n\nOK"}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":407,"frames":406,"bytes":85687,"text_len":3703,"first_chunk_ms":5,"ms":68563,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"require-corp"}
----- CDP network events (preflights + blocks) -----
  {"k":"loadingFailed","type":"Image","err":"net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep","blockedReason":"corp-not-same-origin-after-defaulted-to-same-origin-by-coep","corsError":null}
  {"k":"preflight-sent","url":"https://api.anthropic.com/v1/messages"}
  {"k":"preflight-resp","url":"https://api.anthropic.com/v1/messages","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"https://api.openai.com/v1/chat/completions"}
  {"k":"preflight-resp","url":"https://api.openai.com/v1/chat/completions","status":200,"corp":"(absent)","acao":"http://127.0.0.1:8821"}
  {"k":"loadingFailed","type":"Fetch","err":"net::ERR_FAILED","blockedReason":null,"corsError":"MissingAllowOriginHeader"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8873/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8873/v1/chat/completions","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8824/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8824/v1/chat/completions","status":204,"corp":"(absent)","acao":"(absent)"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [requestfailed] GET https://www.python.org/static/favicon.ico?x=1788245924434 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### model / chromium / coep:credentialless

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"credentialless"}
  [console] PROBE reloading = {"attempt":1}
  [console] PROBE first_paint = {"coi":true,"SAB":"function","mode":"credentialless"}
  [console] PROBE controls = {"control_404":{"status":404,"server_hdr_coep":"credentialless","sw_synthesised_coep":"credentialless"},"enforcement_nocorp_img":{"loaded":true,"w":48},"coi":true,"SAB":"function"}
crossOriginIsolated=true  SAB=function  reloads=1
ENFORCEMENT CONTROL (cross-origin no-CORP <img> python.org): {"loaded":true,"w":48}
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":276,"ms":277,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Failed to fetch"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":73,"ms":73,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":18,"frames":17,"bytes":3606,"text_len":5,"first_chunk_ms":5,"ms":2108,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":374,"frames":373,"bytes":78591,"text_len":3318,"first_chunk_ms":5,"ms":68957,"text_head":"\nWe need to answer user's request: \"Write a detailed 600-word explanation of how a CPU cac"}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":22,"ms":947,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":true,"inner_coi":true,"inner_SAB":"function","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":12,"frames":12,"bytes":2617,"text_len":5,"first_chunk_ms":3,"ms":1808,"text_head":"\n\nOK."}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":388,"frames":387,"bytes":81991,"text_len":3679,"first_chunk_ms":6,"ms":81783,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"credentialless"}
----- CDP network events (preflights + blocks) -----
  {"k":"preflight-sent","url":"https://api.anthropic.com/v1/messages"}
  {"k":"preflight-resp","url":"https://api.anthropic.com/v1/messages","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"https://api.openai.com/v1/chat/completions"}
  {"k":"preflight-resp","url":"https://api.openai.com/v1/chat/completions","status":200,"corp":"(absent)","acao":"http://127.0.0.1:8821"}
  {"k":"loadingFailed","type":"Fetch","err":"net::ERR_FAILED","blockedReason":null,"corsError":"MissingAllowOriginHeader"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8873/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8873/v1/chat/completions","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8824/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8824/v1/chat/completions","status":204,"corp":"(absent)","acao":"(absent)"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://127.0.0.1:8821' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### model / webkit / coep:off

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"off"}
  [console] PROBE controls = {"control_404":{"status":404,"server_hdr_coep":null,"sw_synthesised_coep":null},"enforcement_nocorp_img":{"loaded":true,"w":48},"coi":false,"SAB":"undefined"}
crossOriginIsolated=false  SAB=undefined  reloads=0
ENFORCEMENT CONTROL (cross-origin no-CORP <img> python.org): {"loaded":true,"w":48}
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":377,"ms":378,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Load failed"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":178,"ms":178,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":20,"frames":19,"bytes":4026,"text_len":5,"first_chunk_ms":6,"ms":3786,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":378,"frames":377,"bytes":80299,"text_len":3800,"first_chunk_ms":4,"ms":84395,"text_head":"\nWe need to write a detailed 600-word explanation of how a CPU cache works. Do not stop ea"}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":4,"ms":837,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":false,"inner_coi":false,"inner_SAB":"undefined","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":21,"frames":20,"bytes":4249,"text_len":0,"first_chunk_ms":4,"ms":3754,"text_head":""}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":382,"frames":382,"bytes":79106,"text_len":2709,"first_chunk_ms":5,"ms":93462,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":null}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.openai.com/v1/chat/completions due to access control checks.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### model / webkit / coep:require-corp

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"require-corp"}
  [console] PROBE reloading = {"attempt":1}
  [console] PROBE first_paint = {"coi":true,"SAB":"function","mode":"require-corp"}
  [console] PROBE controls = {"control_404":{"status":404,"server_hdr_coep":"require-corp","sw_synthesised_coep":"require-corp"},"enforcement_nocorp_img":{"loaded":false},"coi":true,"SAB":"function"}
crossOriginIsolated=true  SAB=function  reloads=1
ENFORCEMENT CONTROL (cross-origin no-CORP <img> python.org): {"loaded":false}
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":182,"ms":182,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Load failed"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":81,"ms":81,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":14,"frames":13,"bytes":2805,"text_len":5,"first_chunk_ms":4,"ms":13385,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":407,"frames":406,"bytes":83798,"text_len":2756,"first_chunk_ms":4,"ms":237004,"text_head":"\nWe need to answer user: \"Write a detailed 600-word explanation of how a CPU cache works. "}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":3,"ms":841,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":true,"inner_coi":true,"inner_SAB":"function","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":22,"frames":21,"bytes":4355,"text_len":4,"first_chunk_ms":5,"ms":63859,"text_head":"\n\nOK"}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":410,"frames":411,"bytes":86309,"text_len":3549,"first_chunk_ms":6,"ms":222518,"text_head":"\nWe need answer user: \"Write a detailed 600-word explanation of how a CPU cache works. Do "}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"require-corp"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Cancelled load to https://www.python.org/static/favicon.ico?x=1788246501146 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://www.python.org/static/favicon.ico?x=1788246501146 due to access control checks.
  [requestfailed] GET https://www.python.org/static/favicon.ico?x=1788246501146 :: Cancelled load to https://www.python.org/static/favicon.ico?x=1788246501146 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://www.python.org/static/favicon.ico?x=1788246501146 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.openai.com/v1/chat/completions due to access control checks.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### model / webkit / coep:credentialless

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"credentialless"}
  [console] PROBE reloading = {"attempt":1}
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"credentialless"}
  [console] PROBE reloading = {"attempt":2}
  [console] PROBE first_paint = {"coi":false,"SAB":"undefined","mode":"credentialless"}
  [console] PROBE controls = {"control_404":{"status":404,"server_hdr_coep":"credentialless","sw_synthesised_coep":"credentialless"},"enforcement_nocorp_img":{"loaded":true,"w":48},"coi":false,"SAB":"undefined"}
crossOriginIsolated=false  SAB=undefined  reloads=2
ENFORCEMENT CONTROL (cross-origin no-CORP <img> python.org): {"loaded":true,"w":48}
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":246,"ms":247,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Load failed"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":100,"ms":100,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":21,"frames":20,"bytes":4179,"text_len":4,"first_chunk_ms":5,"ms":49163,"text_head":"\n\nOK"}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":408,"frames":408,"bytes":86387,"text_len":3864,"first_chunk_ms":4,"ms":194758,"text_head":"\nWe need to answer user: \"Write a detailed 600-word explanation of how a CPU cache works. "}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":4,"ms":840,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:8821","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":false,"inner_coi":false,"inner_SAB":"undefined","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":23,"frames":24,"bytes":5085,"text_len":103,"first_chunk_ms":4,"ms":38024,"text_head":"\nThinking:\n\n1.  **Analyze the Request:** The user wants me to say \"OK\".\n2.  **Formulate Re"}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":409,"frames":408,"bytes":86003,"text_len":3687,"first_chunk_ms":6,"ms":197098,"text_head":"\nWe need answer user: \"Write a detailed 600-word explanation of how a CPU cache works. Do "}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"credentialless"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.openai.com/v1/chat/completions due to access control checks.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:8821 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

## pty

establishes: whether one guest boot survives many commands with blocking stdin, whether its filesystem carries state between them, what a resident guest costs in host RSS, where the input-line boundary is, and whether any of it survives a page reload
cannot say:  anything about src/backend/sandbox/C2wSandbox.js or the built app in out/ — neither is loaded here — and nothing about a phone: this is headless desktop Chromium pulling ~107 MB over loopback

### pty / chromium / coep:require-corp

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent)
BASELINE browser RSS (page not yet loaded) = 734016 KB over 7 processes
FIRST NAV: status=200 coep_on_wire=(absent)
ISOLATION: coi=true reloads=1 sw=null
BACKEND REALM (page->worker): {"backend_coi":true,"backend_SAB":"function","measureUASM":"undefined","deviceMemory":8,"hardwareConcurrency":16}

===== ONE-SHOT via vm-worker.js (page -> backend worker -> sandbox worker) =====
PEAK browser RSS = 1430000 KB  (delta over baseline = 533936 KB = 521.4 MB)
wall ms       = 1094
bootMs        = 112   (fetch + compile)
runMs         = 980    (instantiate + whole guest boot + command)
bytes         = 107054914
exit code     = 0   trap=(none)
stubbed       = ["sock_accept"]
STDOUT >>>
Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux
RC=0

<<< STDOUT

===== ONE-SHOT via vm-worker-streaming.js (page -> backend worker -> sandbox worker) =====
PEAK browser RSS = 1453120 KB  (delta over baseline = 193968 KB = 189.4 MB)
wall ms       = 992
bootMs        = 114   (fetch + compile)
runMs         = 876    (instantiate + whole guest boot + command)
bytes         = -1
exit code     = 0   trap=(none)
stubbed       = ["sock_accept"]
STDOUT >>>
Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux
RC=0

<<< STDOUT

===== PTY BOOT: one guest, blocking stdin =====
RSS after page load, before ptyBoot = 1230160 KB
ptyBoot -> {"startedMs":151,"note":{"type":"note","text":"running argv=[\"arg0\"]"}}
FIRST OUTPUT (3826 ms, timedOut=false):
--- rendered ---
/ # [6n
--- end ---
RSS with guest RESIDENT at prompt = 1580464 KB (delta over baseline = 826.6 MB)

$ "echo hello > /tmp/a\n"   -> 112 ms (wall 2112, timedOut=false)
echo hello > /tmp/a
/ # [6n

$ "cat /tmp/a\n"   -> 415 ms (wall 2415, timedOut=false)
cat /tmp/a
hello
/ # [6n

$ "ls -la /tmp\n"   -> 213 ms (wall 2213, timedOut=false)
ls -la /tmp
total 4
drwxrwxrwt    1 root     root            60 Sep  1 07:26 [1;34m.[m
drwxr-xr-x    1 root     root           100 Aug 30 05:12 [1;34m..[m
-rw-r--r--    1 root     root             6 Sep  1 07:26 [0;0ma[m
/ # [6n

stats: {"state":"poll","readCount":3,"writeCount":23,"pollCount":8803,"pendingToGuest":0,"pendingFromGuest":0,"readLens":{"128":3}}
RSS after 3 commands, guest STILL RESIDENT = 1589824 KB (delta 835.8 MB)
RSS after 20 s IDLE with guest resident = 1568368 KB (delta 814.8 MB)

$ df / mount / free  -> 216 ms
df -h / /tmp 2>&1 | head -5; mount | head -4; free | head -2
Filesystem                Size      Used Available Use% Mounted on
overlay                  56.3M     20.0K     56.3M   0% /
overlay                  56.3M     20.0K     56.3M   0% /
overlay on / type overlay (rw,relatime,lowerdir=/oci/rootfs,upperdir=/run/rootfs-upper,workdir=/run/rootfs-work)
proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)
tmpfs on /dev type tmpfs (rw,nosuid,size=65536k,mode=755)
devpts on /dev/pts type devpts (rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=666)
              total        used        free      shared  buff/cache   available
Mem:         115244       10296       83116          28       21832      100632
/ # [6n

===== ten commands on ONE boot =====
TIMES = [106,110,108,108,110,109,108,107,107,106]

===== the input-line boundary, binary-searched to the byte =====
line of 2047 bytes (incl newline) -> wc -c = 2034
line of 2048 bytes (incl newline) -> wc -c = LINE LOST
line of 2049 bytes (incl newline) -> wc -c = LINE LOST
line of 2054 bytes (incl newline) -> wc -c = LINE LOST
line of 2062 bytes (incl newline) -> wc -c = LINE LOST
line of 4110 bytes (incl newline) -> wc -c = LINE LOST

===== a heredoc has no such cap =====
heredoc body = 11889 bytes over 400 lines, written in 4961 ms
sh /tmp/big.sh; wc -l /tmp/big.out; tail -1 /tmp/big.out
400 /tmp/big.out
line 399
/ # [6n

===== THE RELOAD: page.reload(), same tab, same context =====
after reload: coi=true reloads=1
RSS right after reload, NO guest running = 1561392 KB (delta over baseline 808.0 MB)
RE-BOOT after reload: prompt after 3821 ms (wall 3952 ms)
$ "cat /tmp/a; echo RC=$?\n" -> 112 ms
cat /tmp/a; echo RC=$?
cat: can't open '/tmp/a': No such file or directory
RC=1
/ # [6n
$ "ls -la /tmp\n" -> 211 ms
ls -la /tmp
total 2
drwxrwxrwt    2 root     root          2048 Apr 15 16:10 [1;34m.[m
drwxr-xr-x    1 root     root            80 Aug 30 05:12 [1;34m..[m
/ # [6n
----- console / network -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [wasm] status=200 ct=application/wasm coep=require-corp
  [wasm] status=200 ct=application/wasm coep=require-corp
  [wasm] status=200 ct=application/wasm coep=require-corp
  [wasm] status=200 ct=application/wasm coep=require-corp
```

finished 2026-09-01T07:27:29.393Z — 13 cells, 1 driver failures
