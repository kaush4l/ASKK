# Validation evidence

These records distinguish native execution, isolated artifact checks, browser workbench
checks, and browser Linux execution. A passing artifact or native command does not prove
the browser guest passed the same workload. Failed and interrupted attempts are retained.

Run records with an `_redaction` entry are **public redacted copies**, not exact original
prompt, request, output, or file-path bytes. Home-directory prefixes are replaced with
`<HOME>`. Each entry records the replacement count and the original file's SHA-256 and
byte length. Original token receipts, character counts, budget estimates, timings, source
fingerprints, and other recorded measurements remain unchanged; they describe the original
run and must not be recomputed from or directly byte-compared with redacted public text.

Before redaction, raw originals were preserved locally under `.cache/evidence/raw/` with
file permissions `0600` and directory permissions `0700`. That ignored local directory is
not part of the published evidence. A source-only scan is not an audit of image, archive,
or WebAssembly contents.
