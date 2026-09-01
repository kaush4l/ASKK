# probe run 2026-09-01T07:44:38.087Z

```
entry            bun scripts/probe/run.js --port=9011 --echo-port=9014
host             http://127.0.0.1:9011/   (roots: scripts/probe/page, public/sandbox)
echo endpoint    http://127.0.0.1:9014   (ACAO *, deliberately no CORP, records what it receives)
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
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395b :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [pageerror] SharedArrayBuffer is not defined
  [requestfailed] http://127.0.0.1:9011/does-not-exist-1788248682651.txt :: net::ERR_ABORTED
  [requestfailed] http://127.0.0.1:9011/coi-serviceworker.js?probe=1788248682661 :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
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
  sw_registered = {"scope":"http://127.0.0.1:9011/"}
  crossOriginIsolated = true
  controller = true
  SharedArrayBuffer = {"ok":true,"byteLength":8}
  atomics_timeout-probe = {"phase":"timeout-probe","result":"timed-out","ms":52}
  atomics_blocking-probe = {"phase":"blocking-probe","result":"ok","ms":252}
  Atomics.wait = {"ok":true,"wake_ms":252,"main_thread_still_alive_ms":307}
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
NESTED Atomics.wait (page->worker->worker): {"outer_coi":true,"outer_sab":"function","inner":{"inner_coi":true,"inner_sab":"function","atomics_wait":"ok","blocked_ms":199}}
SW-SERVED SAME-ORIGIN HEADERS: {"status":200,"coep":"require-corp","coop":"same-origin","corp":"same-origin"}
HARD RELOAD: nav_status=200 crossOriginIsolated=true sw_controller=true
COLD FIRST VISIT: isolated_at_first_load=false -> after_sw_install=true reloads_needed=1 navigations=2
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://esm.sh/marked@12.0.2 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://www.python.org/static/favicon.ico?x=1788248687224 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://developer.mozilla.org/favicon.ico?x=1788248687366 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [requestfailed] http://127.0.0.1:9011/coi-serviceworker.js?probe=1788248688102 :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://esm.sh/marked@12.0.2 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://www.python.org/static/favicon.ico?x=1788248689214 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [requestfailed] https://developer.mozilla.org/favicon.ico?x=1788248689288 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### isolation / chromium / coep:credentialless

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = true
  first_paint_SAB_typeof = "function"
  sw_registered = {"scope":"http://127.0.0.1:9011/"}
  crossOriginIsolated = true
  controller = true
  SharedArrayBuffer = {"ok":true,"byteLength":8}
  atomics_timeout-probe = {"phase":"timeout-probe","result":"timed-out","ms":59}
  atomics_blocking-probe = {"phase":"blocking-probe","result":"ok","ms":252}
  Atomics.wait = {"ok":true,"wake_ms":252,"main_thread_still_alive_ms":314}
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
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [requestfailed] https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395b :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [requestfailed] http://127.0.0.1:9011/coi-serviceworker.js?probe=1788248693740 :: net::ERR_ABORTED
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.anthropic.com/v1/models' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  [requestfailed] https://api.anthropic.com/v1/models :: net::ERR_FAILED
  [console.error] Failed to load resource: net::ERR_FAILED
  [console.error] Access to fetch at 'https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
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
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [pageerror] Can't find variable: SharedArrayBuffer
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### isolation / webkit / coep:require-corp

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = true
  first_paint_SAB_typeof = "function"
  sw_registered = {"scope":"http://127.0.0.1:9011/"}
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
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /esm.sh/marked@12.0.2 due to access control checks.
  [requestfailed] https://esm.sh/marked@12.0.2 :: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json due to access control checks.
  [requestfailed] https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json :: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://www.python.org/static/favicon.ico?x=1788248702942 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://www.python.org/static/favicon.ico?x=1788248702942 due to access control checks.
  [requestfailed] https://www.python.org/static/favicon.ico?x=1788248702942 :: Cancelled load to https://www.python.org/static/favicon.ico?x=1788248702942 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://www.python.org/static/favicon.ico?x=1788248702942 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788248703095 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://developer.mozilla.org/favicon.ico?x=1788248703095 due to access control checks.
  [requestfailed] https://developer.mozilla.org/favicon.ico?x=1788248703095 :: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788248703095 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788248703095 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /esm.sh/marked@12.0.2 due to access control checks.
  [requestfailed] https://esm.sh/marked@12.0.2 :: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://esm.sh/marked@12.0.2 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [pageerror] /huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json due to access control checks.
  [requestfailed] https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json :: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cross-origin redirection to https://huggingface.co/api/resolve-cache/models/Xenova/whisper-tiny.en/79fb389fc764e7c395bd330e9531d9d32ada7049/config.json?%2FXenova%2Fwhisper-tiny.en%2Fresolve%2Fmain%2Fconfig.json=&etag=%228170b9ae19fe3eec3501b3179afafd2e09ea7731%22 denied by Cross-Origin Resource Sharing policy: Cancelled load to https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/config.json because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://www.python.org/static/favicon.ico?x=1788248704773 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://www.python.org/static/favicon.ico?x=1788248704773 due to access control checks.
  [requestfailed] https://www.python.org/static/favicon.ico?x=1788248704773 :: Cancelled load to https://www.python.org/static/favicon.ico?x=1788248704773 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://www.python.org/static/favicon.ico?x=1788248704773 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788248704873 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://developer.mozilla.org/favicon.ico?x=1788248704873 due to access control checks.
  [requestfailed] https://developer.mozilla.org/favicon.ico?x=1788248704873 :: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788248704873 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://developer.mozilla.org/favicon.ico?x=1788248704873 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

### isolation / webkit / coep:credentialless

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent) corp=(absent)
FIRST NAV: status=200 coep_on_wire=(absent)
FIRST NAV IN-PAGE (before any reload settles): crossOriginIsolated=false SharedArrayBuffer=undefined
  first_paint_crossOriginIsolated = false
  first_paint_SAB_typeof = "undefined"
  sw_registered = {"scope":"http://127.0.0.1:9011/"}
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
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [pageerror] Can't find variable: SharedArrayBuffer
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.anthropic.com/v1/models due to access control checks.
  [requestfailed] https://api.anthropic.com/v1/models :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [pageerror] /en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo due to access control checks.
  [requestfailed] https://en.wikipedia.org/w/api.php?action=query&format=json&meta=siteinfo :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 200
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
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":274,"ms":274,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Failed to fetch"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":98,"ms":99,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":17,"frames":17,"bytes":3626,"text_len":4,"first_chunk_ms":8,"ms":10205,"text_head":"\n\nOK"}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":405,"frames":406,"bytes":85724,"text_len":3729,"first_chunk_ms":4,"ms":94702,"text_head":"\nWe need respond to user: \"Write a detailed 600-word explanation of how a CPU cache works."}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":5,"ms":862,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":false,"inner_coi":false,"inner_SAB":"undefined","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":11,"frames":12,"bytes":2616,"text_len":5,"first_chunk_ms":3,"ms":2706,"text_head":"\n\nOK."}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":407,"frames":406,"bytes":85704,"text_len":3715,"first_chunk_ms":9,"ms":97022,"text_head":"\nWe need answer user's request: \"Write a detailed 600-word explanation of how a CPU cache "}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":null}
----- CDP network events (preflights + blocks) -----
  {"k":"preflight-sent","url":"https://api.anthropic.com/v1/messages"}
  {"k":"preflight-resp","url":"https://api.anthropic.com/v1/messages","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"https://api.openai.com/v1/chat/completions"}
  {"k":"preflight-resp","url":"https://api.openai.com/v1/chat/completions","status":200,"corp":"(absent)","acao":"http://127.0.0.1:9011"}
  {"k":"loadingFailed","type":"Fetch","err":"net::ERR_FAILED","blockedReason":null,"corsError":"MissingAllowOriginHeader"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8873/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8873/v1/chat/completions","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"http://127.0.0.1:9014/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:9014/v1/chat/completions","status":204,"corp":"(absent)","acao":"(absent)"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
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
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":297,"ms":297,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Failed to fetch"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":89,"ms":89,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":15,"frames":14,"bytes":3025,"text_len":5,"first_chunk_ms":5,"ms":9739,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":406,"frames":406,"bytes":85757,"text_len":3742,"first_chunk_ms":5,"ms":105605,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":5,"ms":867,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":true,"inner_coi":true,"inner_SAB":"function","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":23,"frames":23,"bytes":4979,"text_len":140,"first_chunk_ms":2,"ms":17432,"text_head":"\nThe user wants me to say “OK.” This is a very simple request. I need to output exactly th"}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":404,"frames":406,"bytes":85618,"text_len":3672,"first_chunk_ms":19,"ms":111631,"text_head":"\nWe need answer user's request: \"Write a detailed 600-word explanation of how a CPU cache "}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"require-corp"}
----- CDP network events (preflights + blocks) -----
  {"k":"loadingFailed","type":"Image","err":"net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep","blockedReason":"corp-not-same-origin-after-defaulted-to-same-origin-by-coep","corsError":null}
  {"k":"preflight-sent","url":"https://api.anthropic.com/v1/messages"}
  {"k":"preflight-resp","url":"https://api.anthropic.com/v1/messages","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"https://api.openai.com/v1/chat/completions"}
  {"k":"preflight-resp","url":"https://api.openai.com/v1/chat/completions","status":200,"corp":"(absent)","acao":"http://127.0.0.1:9011"}
  {"k":"loadingFailed","type":"Fetch","err":"net::ERR_FAILED","blockedReason":null,"corsError":"MissingAllowOriginHeader"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8873/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8873/v1/chat/completions","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"http://127.0.0.1:9014/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:9014/v1/chat/completions","status":204,"corp":"(absent)","acao":"(absent)"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [requestfailed] GET https://www.python.org/static/favicon.ico?x=1788248948725 :: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
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
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":257,"ms":257,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Failed to fetch"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":124,"ms":124,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":22,"frames":23,"bytes":4906,"text_len":105,"first_chunk_ms":7,"ms":14876,"text_head":"\nThinking:\n\n1.  **Analyze the Request:** The user is asking me to say \"OK\".\n2.  **Determin"}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":384,"frames":386,"bytes":81974,"text_len":3773,"first_chunk_ms":5,"ms":52082,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":4,"ms":861,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":true,"inner_coi":true,"inner_SAB":"function","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":13,"frames":12,"bytes":2616,"text_len":5,"first_chunk_ms":2,"ms":3389,"text_head":"\n\nOK."}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":158,"frames":158,"bytes":38043,"text_len":3686,"first_chunk_ms":4,"ms":20386,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"credentialless"}
----- CDP network events (preflights + blocks) -----
  {"k":"preflight-sent","url":"https://api.anthropic.com/v1/messages"}
  {"k":"preflight-resp","url":"https://api.anthropic.com/v1/messages","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"https://api.openai.com/v1/chat/completions"}
  {"k":"preflight-resp","url":"https://api.openai.com/v1/chat/completions","status":200,"corp":"(absent)","acao":"http://127.0.0.1:9011"}
  {"k":"loadingFailed","type":"Fetch","err":"net::ERR_FAILED","blockedReason":null,"corsError":"MissingAllowOriginHeader"}
  {"k":"preflight-sent","url":"http://127.0.0.1:8873/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:8873/v1/chat/completions","status":200,"corp":"(absent)","acao":"*"}
  {"k":"preflight-sent","url":"http://127.0.0.1:9014/v1/chat/completions"}
  {"k":"preflight-resp","url":"http://127.0.0.1:9014/v1/chat/completions","status":204,"corp":"(absent)","acao":"(absent)"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://127.0.0.1:9011' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
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
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":538,"ms":539,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Load failed"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":100,"ms":100,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":9,"frames":9,"bytes":2097,"text_len":5,"first_chunk_ms":14,"ms":1112,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":148,"frames":148,"bytes":36478,"text_len":3882,"first_chunk_ms":5,"ms":19797,"text_head":"\nWe need answer user's request: \"Write a detailed 600-word explanation of how a CPU cache "}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":8,"ms":862,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"OPTIONS","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":"POST","acrh":"anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key","sec_fetch_mode":"cors","custom":{}},{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":false,"inner_coi":false,"inner_SAB":"undefined","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":7,"frames":8,"bytes":1848,"text_len":5,"first_chunk_ms":6,"ms":944,"text_head":"\n\nOK."}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":158,"frames":160,"bytes":38572,"text_len":3764,"first_chunk_ms":10,"ms":19953,"text_head":"\nWe need to respond to user: \"Write a detailed 600-word explanation of how a CPU cache wor"}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":null}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.openai.com/v1/chat/completions due to access control checks.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
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
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":161,"ms":161,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Load failed"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":92,"ms":92,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":8,"frames":8,"bytes":1849,"text_len":5,"first_chunk_ms":15,"ms":882,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":157,"frames":157,"bytes":38142,"text_len":3838,"first_chunk_ms":5,"ms":19456,"text_head":"\nWe need to answer user's request: \"Write a detailed 600-word explanation of how a CPU cac"}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":8,"ms":868,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":true,"inner_coi":true,"inner_SAB":"function","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":8,"frames":8,"bytes":1850,"text_len":5,"first_chunk_ms":9,"ms":883,"text_head":"\n\nOK."}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":155,"frames":155,"bytes":37971,"text_len":3941,"first_chunk_ms":15,"ms":20904,"text_head":"\nWe need answer user: \"Write a detailed 600-word explanation of how a CPU cache works. Do "}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"require-corp"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Cancelled load to https://www.python.org/static/favicon.ico?x=1788249423211 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Cannot load image https://www.python.org/static/favicon.ico?x=1788249423211 due to access control checks.
  [requestfailed] GET https://www.python.org/static/favicon.ico?x=1788249423211 :: Cancelled load to https://www.python.org/static/favicon.ico?x=1788249423211 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: Cancelled load to https://www.python.org/static/favicon.ico?x=1788249423211 because it violates the resource's Cross-Origin-Resource-Policy response header.
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.openai.com/v1/chat/completions due to access control checks.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
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
PAGE  anthropic     {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json","acao":"*","corp":null,"chunks":1,"frames":0,"bytes":106,"text_len":0,"first_chunk_ms":173,"ms":173,"text_head":""}
PAGE  openai        {"phase":"fetch","arrived":false,"err_name":"TypeError","err":"Load failed"}
PAGE  openai_noauth {"phase":"complete","arrived":true,"status":401,"type":"cors","ok":false,"has_readable_body":true,"ct":"application/json; charset=utf-8","acao":null,"corp":null,"chunks":1,"frames":0,"bytes":496,"text_len":0,"first_chunk_ms":336,"ms":336,"text_head":""}
PAGE  local_short   {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":8,"frames":9,"bytes":2123,"text_len":5,"first_chunk_ms":10,"ms":1109,"text_head":"\n\nOK."}
PAGE  local_long    {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":160,"frames":160,"bytes":38562,"text_len":3762,"first_chunk_ms":5,"ms":20069,"text_head":"\nWe need respond to user: \"Write a detailed 600-word explanation of how a CPU cache works."}
ECHO (CORP-less, preflighted, SSE) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":41,"frames":40,"bytes":2084,"text_len":230,"first_chunk_ms":7,"ms":865,"text_head":"tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok1"}
ECHO SERVER RECEIVED: [{"method":"POST","path":"/v1/chat/completions","origin":"http://127.0.0.1:9011","acrm":null,"acrh":null,"sec_fetch_mode":"cors","custom":{"x-api-key":"sk-ant-not-a-real-key-deliberately","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"}}]
NESTED local_short (page->worker->worker) {"depth":2,"outer_coi":false,"inner_coi":false,"inner_SAB":"undefined","which":"local_short","result":{"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":11,"frames":11,"bytes":2530,"text_len":5,"first_chunk_ms":7,"ms":1321,"text_head":"\n\nOK."}}
… idling 30s while isolated …
AGED local_long (after 30s isolated) {"phase":"complete","arrived":true,"status":200,"type":"cors","ok":true,"has_readable_body":true,"ct":"text/event-stream; charset=utf-8","acao":null,"corp":null,"chunks":165,"frames":165,"bytes":39849,"text_len":3924,"first_chunk_ms":11,"ms":21474,"text_head":"\nWe need answer user: \"Write a detailed 600-word explanation of how a CPU cache works. Do "}
404 CONTROL (end of pass, in-page through SW): {"status":404,"coep":"credentialless"}
----- network / console noise -----
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [pageerror] /api.openai.com/v1/chat/completions due to access control checks.
  [requestfailed] POST https://api.openai.com/v1/chat/completions :: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: Origin http://127.0.0.1:9011 is not allowed by Access-Control-Allow-Origin. Status code: 401
  [console.error] Failed to load resource: the server responded with a status of 401 ()
  [console.error] Failed to load resource: the server responded with a status of 404 (Not Found)
```

## pty

establishes: whether one guest boot survives many commands with blocking stdin, whether its filesystem carries state between them, what a resident guest costs in host RSS, where the input-line boundary is, and whether any of it survives a page reload
cannot say:  anything about src/backend/sandbox/C2wSandbox.js or the built app in out/ — neither is loaded here — and nothing about a phone: this is headless desktop Chromium pulling ~107 MB over loopback

### pty / chromium / coep:require-corp

```
404 CONTROL: status=404 server=askk-probe/1 coep=(absent) coop=(absent)
BASELINE browser RSS (page not yet loaded) = 732304 KB over 7 processes
FIRST NAV: status=200 coep_on_wire=(absent)
ISOLATION: coi=true reloads=1 sw=null
BACKEND REALM (page->worker): {"backend_coi":true,"backend_SAB":"function","measureUASM":"undefined","deviceMemory":8,"hardwareConcurrency":16}

===== ONE-SHOT via vm-worker.js (page -> backend worker -> sandbox worker) =====
PEAK browser RSS = 1431392 KB  (delta over baseline = 531664 KB = 519.2 MB)
wall ms       = 911
bootMs        = 92   (fetch + compile)
runMs         = 817    (instantiate + whole guest boot + command)
bytes         = 107054914
exit code     = 0   trap=(none)
stubbed       = ["sock_accept"]
STDOUT >>>
Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux
RC=0

<<< STDOUT

===== ONE-SHOT via vm-worker-streaming.js (page -> backend worker -> sandbox worker) =====
PEAK browser RSS = 1449776 KB  (delta over baseline = 135728 KB = 132.5 MB)
wall ms       = 909
bootMs        = 95   (fetch + compile)
runMs         = 813    (instantiate + whole guest boot + command)
bytes         = -1
exit code     = 0   trap=(none)
stubbed       = ["sock_accept"]
STDOUT >>>
Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux
RC=0

<<< STDOUT

===== PTY BOOT: one guest, blocking stdin =====
RSS after page load, before ptyBoot = 1328416 KB
ptyBoot -> {"startedMs":122,"note":{"type":"note","text":"running argv=[\"arg0\"]"}}
FIRST OUTPUT (3931 ms, timedOut=false):
--- rendered ---
/ # [6n
--- end ---
RSS with guest RESIDENT at prompt = 1617472 KB (delta over baseline = 864.4 MB)

$ "echo hello > /tmp/a\n"   -> 113 ms (wall 2113, timedOut=false)
echo hello > /tmp/a
/ # [6n

$ "cat /tmp/a\n"   -> 419 ms (wall 2419, timedOut=false)
cat /tmp/a
hello
/ # [6n

$ "ls -la /tmp\n"   -> 217 ms (wall 2217, timedOut=false)
ls -la /tmp
total 4
drwxrwxrwt    1 root     root            60 Sep  1 07:59 [1;34m.[m
drwxr-xr-x    1 root     root           100 Aug 30 05:12 [1;34m..[m
-rw-r--r--    1 root     root             6 Sep  1 07:59 [0;0ma[m
/ # [6n

stats: {"state":"poll","readCount":3,"writeCount":23,"pollCount":7466,"pendingToGuest":0,"pendingFromGuest":0,"readLens":{"128":3}}
RSS after 3 commands, guest STILL RESIDENT = 1625168 KB (delta 871.9 MB)
RSS after 20 s IDLE with guest resident = 1601792 KB (delta 849.1 MB)

$ df / mount / free  -> 325 ms
df -h / /tmp 2>&1 | head -5; mount | head -4; free | head -2
Filesystem                Size      Used Available Use% Mounted on
overlay                  56.3M     20.0K     56.3M   0% /
overlay                  56.3M     20.0K     56.3M   0% /
overlay on / type overlay (rw,relatime,lowerdir=/oci/rootfs,upperdir=/run/rootfs-upper,workdir=/run/rootfs-work)
proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)
tmpfs on /dev type tmpfs (rw,nosuid,size=65536k,mode=755)
devpts on /dev/pts type devpts (rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=666)
              total        used        free      shared  buff/cache   available
Mem:         115244       10288       83124          28       21832      100656
/ # [6n

===== ten commands on ONE boot =====
TIMES = [112,109,110,112,109,110,105,110,110,109]

===== the input-line boundary, binary-searched to the byte =====
line of 2047 bytes (incl newline) -> wc -c = 2034
line of 2048 bytes (incl newline) -> wc -c = LINE LOST
line of 2049 bytes (incl newline) -> wc -c = LINE LOST
line of 2054 bytes (incl newline) -> wc -c = LINE LOST
line of 2062 bytes (incl newline) -> wc -c = LINE LOST
line of 4110 bytes (incl newline) -> wc -c = LINE LOST

===== a heredoc has no such cap =====
heredoc body = 11889 bytes over 400 lines, written in 4827 ms
sh /tmp/big.sh; wc -l /tmp/big.out; tail -1 /tmp/big.out
400 /tmp/big.out
line 399
/ # [6n

===== how much slower is the guest? (same busybox, same bytes) =====
guest: uname -m; busybox | head -1
x86_64
BusyBox v1.37.0 (2025-11-23 13:10:04 UTC) multi-call binary.
/ # [6n
[guest] awk 1e6 loop: host-observed 86131 ms
awk 'BEGIN{s=0;for(i=0;i<1000000;i++)s+=i;print s}'
499999500000
/ # [6n
[guest] sha256sum 8MB: host-observed 9914 ms
sha256sum /tmp/8m
2daeb1f36095b44b318410b3f4e8b5d989dcc7bb023d1426c492dab0a3053e74  /tmp/8m
/ # [6n
[guest] gzip -c 8MB: host-observed 8018 ms
gzip -c /tmp/8m | wc -c
8162
/ # [6n

native control: aarch64 | BusyBox v1.37.0 (2025-11-23 13:10:04 UTC) multi-call binary.
499999500000
real	0m 0.23s
user	0m 0.23s
sys	0m 0.00s
2daeb1f36095b44b318410b3f4e8b5d989dcc7bb023d1426c492dab0a3053e74  /tmp/8m
real	0m 0.02s
user	0m 0.02s
sys	0m 0.00s
real	0m 0.03s
user	0m 0.03s
sys	0m 0.00s
8162


===== install a real .apk into the LIVE guest, delivered over the tty =====
host package: 30316 bytes, md5 c1580b7f3775e59960109e0d41154729, 40955 base64 bytes wrapped at 76 columns
BEFORE:
apk info | wc -l; apk info -e tree; echo TREE_PRESENT=$?; ls -la /usr/bin/tr
ee 2>&1
WARNING: opening from cache https://dl-cdn.alpinelinux.org/alpine/v3.21/main: No such file or directory
WARNING: opening from cache https://dl-cdn.alpinelinux.org/alpine/v3.21/community: No such file or directory
15
TREE_PRESENT=1
lrwxrwxrwx    2 root     root            12 Apr 15 16:10 [1;36m/usr/bin/tree[m -> [1;32m/bin/busybox[m
/ # [6n
delivered 40955 base64 bytes in 14836 ms = 2.70 KB/s (timedOut=false)
base64 -d /tmp/t.b64 > /tmp/t.apk; md5sum /tmp/t.apk; apk add --allow-untrus
ted /tmp/t.apk 2>&1 | tail -3
c1580b7f3775e59960109e0d41154729  /tmp/t.apk
(1/1) Installing tree (2.2.1-r0)
Executing busybox-1.37.0-r14.trigger
OK: 7 MiB in 16 packages
/ # [6n
AFTER:
apk info | wc -l; apk info -e tree; echo TREE_PRESENT=$?; ls -la /usr/bin/tr
ee; tree --version
WARNING: opening from cache https://dl-cdn.alpinelinux.org/alpine/v3.21/main: No such file or directory
WARNING: opening from cache https://dl-cdn.alpinelinux.org/alpine/v3.21/community: No such file or directory
16
tree
TREE_PRESENT=0
-rwxr-xr-x    1 root     root         65072 Dec  5  2024 [1;32m/usr/bin/tree[m
tree v2.2.1 © 1996 - 2024 by Steve Baker, Thomas Moore, Francesc Rocher, Florian Sesser, Kyosuke Tokoro
/ # [6n

and from a REPOSITORY, on the same live shell:
ip addr 2>&1 | head -6; cat /etc/resolv.conf 2>&1; apk update 2>&1 | head -4
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
2: eth0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN qlen 1000
    link/ether 02:00:00:00:00:01 brd ff:ff:ff:ff:ff:ff
fetch https://dl-cdn.alpinelinux.org/alpine/v3.21/main/x86_64/APKINDEX.tar.gz
WARNING: updating and opening https://dl-cdn.alpinelinux.org/alpine/v3.21/main: temporary error (try again later)
fetch https://dl-cdn.alpinelinux.org/alpine/v3.21/community/x86_64/APKINDEX.tar.gz
WARNING: updating and opening https://dl-cdn.alpinelinux.org/alpine/v3.21/community: temporary error (try again later)
/ # [6n

===== THE RELOAD: page.reload(), same tab, same context =====
after reload: coi=true reloads=1
RSS right after reload, NO guest running = 1712304 KB (delta over baseline 957.0 MB)
RE-BOOT after reload: prompt after 3730 ms (wall 3843 ms)
$ "cat /tmp/a; echo RC=$?\n" -> 415 ms
cat /tmp/a; echo RC=$?
cat: can't open '/tmp/a': No such file or directory
RC=1
/ # [6n
$ "ls -la /tmp\n" -> 239 ms
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

finished 2026-09-01T08:03:00.217Z — 13 cells, 0 driver failures
