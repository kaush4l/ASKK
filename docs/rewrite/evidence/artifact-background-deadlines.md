# Hidden-tab artifact deadlines

Actual Chrome 153 on macOS, September 28, 2026; the fixture used the static-host
isolation service worker and an opaque artifact frame. Browser automation focus
emulation was disabled for this fixture tab, then native Chrome tab selection
left it hidden. Timers were not replaced or accelerated in these browser runs.

| Attempt | Result | Recorded elapsed | Evidence |
| --- | --- | --- | --- |
| Initial 1.25-second settling allowance | Failed before any assertion: settling exceeded its budget | 1,581.48 ms | [Failure receipt](artifact-background-chrome-settle-failure.json) |
| Three-second settling allowance | All 37 assertions passed, covering 12 native form submissions | 40,085.61 ms | [Passing receipt](artifact-background-chrome.json) |

Both records report only the hidden visibility state during inspection. The
passing check exceeds the old fixed 12-second segment timeout, while its complete
plan remains bounded by 82,250 ms. The requested initial settling delay remains
500 ms; its three-second allowance permits a late timer without removing the
monotonic deadline checks. Controlled tests also cover a 1,500 ms settling wake,
one-second action timers, expired callbacks, no action replay, and elapsed storage
drain deadlines.

Reproduce with `ARTIFACT_VERIFY_PORT=5202 bun scripts/verify-artifact-isolation.js`,
open the printed URL, and use **Arm 37-action background check** before switching
to another tab. Keep it hidden until the result is saved. The fixture reports a
pass only when all assertions pass, it stayed hidden, and elapsed time exceeds
12 seconds. Background results are separate from the ordinary verification
suite and from the original server on port 5196.

This proves the deadline repair for the native form counter fixture in Chrome.
It does not establish Safari background timing, successful hydration of arbitrary
applications, the task board's acceptance, or browser Linux build performance.
The failed receipt is retained. Public copies contain provenance metadata;
private raw originals have mode `0600`, and neither record contained home paths.
