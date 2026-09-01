// Realm 3. The endpoints ride on the message: a global set on the page is not
// visible here.
importScripts("calls.js");
self.onmessage = async (e) => {
  const { which, echo, local } = e.data;
  if (echo) self.PROBE_ECHO = echo;
  if (local) self.PROBE_LOCAL = local;
  const t = { inner_coi: self.crossOriginIsolated, inner_SAB: typeof SharedArrayBuffer, which };
  try { t.result = await self.REAL_CALLS[which](); }
  catch (err) { t.result = { threw: String(err) }; }
  self.postMessage(t);
};
