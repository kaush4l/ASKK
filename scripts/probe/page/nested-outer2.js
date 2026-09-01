// page -> THIS worker -> inner worker. Exactly the app's agentWorker shape.
let inner = null;
self.onmessage = (e) => {
  if (!inner) {
    inner = new Worker("nested-inner2.js");
    inner.onmessage = (m) => self.postMessage({ depth: 2, outer_coi: self.crossOriginIsolated, ...m.data });
    inner.onerror = (er) => self.postMessage({ depth: 2, err: "inner onerror: " + (er.message || er) });
  }
  inner.postMessage(e.data);
};
