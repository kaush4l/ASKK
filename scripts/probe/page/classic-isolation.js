// A CLASSIC worker, created the way `C2wSandbox` creates `vm-worker.js`, that
// reports the one thing the guest cells cannot report about themselves: whether
// the realm doing the cross-origin fetch is the isolated one. A page that says
// `crossOriginIsolated === true` says nothing about its workers unless the
// policy is inherited, and inheritance is the assumption under test.
self.onmessage = () => {
  self.postMessage({
    crossOriginIsolated: self.crossOriginIsolated,
    SharedArrayBuffer: typeof SharedArrayBuffer,
  })
}
