# Packaged Local Bun acceptance

**Passed: 11/11 checks**,2026-09-29T00:11:38.583Z through00:11:44.680Z on Apple Silicon macOS. The [redacted receipt](companion-package-darwin-arm64.json) retains per-file source/runtime hashes and actual exit records. Raw receipt SHA-256: `176211c3162a42957781b105814fae50240779f7629c6f653648372e3c337bc8`, retained privately with mode 0600. Home paths in public output are replaced with `<HOME>`; timings and hashes are unchanged.

The runner copied the pinned Bun 1.4.2 runtime into a package, moved it to a path containing a space, verified all manifest files, then launched with system-only PATH and an empty temporary home. The package contains 11 allowlisted files totaling 61,935,041 bytes; it contains no certificate, private key, pairing token, model credential or project dependency tree.

Actual checks proved:

- `--help` starts from the moved package without host Bun or Node on PATH.
- HTTPS and WSS certificate validation succeeded against the explicitly supplied public root CA. Existing external certificate/key files were reused; no trust store or CA was modified.
- Relay-only grants stayed `model-relay,network-relay`; file, job, terminal and unapproved-origin requests returned 403.
- An explicit native-capability restart acknowledged a Unicode file, matched its read revision, and rejected a stale write with 409.
- Both a streamed job and a 103-column/37-row PTY selected the moved package's Bun executable. Host Node/npm were absent from the command PATH.
- Exit 7 was preserved; process-group cancellation produced a real SIGTERM exit and prevented the delayed child write.
- Next 16.3.6 built an App Router webpack static export under the packaged Bun in **2663.870 ms**, with exit 0 and the expected HTML content. Exported `index.html` SHA-256: `2081631a384018f72997c27c0cf335e5128d6347713bd1ad596e7a3a73bd4e80`.
- Each foreground companion shut down with exit 0 and removed its pairing file; tokens did not appear in launcher output. Both owned servers were stopped before handoff.

The separate real companion child-environment job/PTY regression passed 1 test / 3 assertions. Synthetic packaging, explicit-grant, hash, private-file and concurrent-shutdown tests passed 7 tests / 56 assertions before the native run.

This was a native functional probe, not a browser-contained build, one-shot agent task, workbench interaction or browser certificate-trust check. It reused the repository's pinned installed dependencies through a fixture symlink and installed nothing. Next reported its expected tracing-root warning for the temporary home beneath the checkout; the exact warning remains in the receipt. Lightweight UI QA was permitted on the same machine, so measured durations are not isolated performance comparisons. The package remains unsigned/unnotarized, and certificate trust setup remains manual.

The exact tested package is retained locally at `.cache/companion/acceptance-20260929-0011/moved package`. Its contents and receipt are unchanged. Only the repository companion README was updated afterward to describe this result, so future package documentation hashes will differ; the tested executable and implementation hashes remain traceable in the receipt.
