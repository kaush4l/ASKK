// page -> outer worker -> inner worker, mirroring page -> backend worker -> sandbox worker
self.onmessage = (e) => {
  const inner = new Worker("nested-inner.js");
  inner.onmessage = (m) => self.postMessage({ outer_coi: self.crossOriginIsolated, outer_sab: typeof SharedArrayBuffer, inner: m.data });
  const sab = new SharedArrayBuffer(8);
  const ia = new Int32Array(sab);
  inner.postMessage({ sab });
  setTimeout(() => { Atomics.store(ia, 0, 1); Atomics.notify(ia, 0); }, 200);
};
