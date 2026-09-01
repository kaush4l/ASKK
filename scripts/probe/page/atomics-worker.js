self.onmessage = (e) => {
  const ia = new Int32Array(e.data.sab);
  const t0 = Date.now();
  let r1;
  try { r1 = Atomics.wait(ia, 0, 0, 50); } catch (err) { self.postMessage({ err: String(err) }); return; }
  const t1 = Date.now();
  self.postMessage({ phase: "timeout-probe", result: r1, ms: t1 - t0 });
  const t2 = Date.now();
  let r2;
  try { r2 = Atomics.wait(ia, 1, 0); } catch (err) { self.postMessage({ err: String(err) }); return; }
  self.postMessage({ phase: "blocking-probe", result: r2, ms: Date.now() - t2 });
};
