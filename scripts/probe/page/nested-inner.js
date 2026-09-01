self.onmessage = (e) => {
  const ia = new Int32Array(e.data.sab);
  const t = Date.now();
  let r; try { r = Atomics.wait(ia, 0, 0); } catch (err) { r = "throw: " + err; }
  self.postMessage({ inner_coi: self.crossOriginIsolated, inner_sab: typeof SharedArrayBuffer, atomics_wait: r, blocked_ms: Date.now() - t });
};
