// Server desk — REDIRECT, not a second singleton.
//
// The canonical single engine object lives in engine-object.js
// (getEngineObject, module-level cache, one object per location
// in the server process). This module exists only so the
// earlier server-desk API name keeps working: getServerDesk IS
// getEngineObject, returning the same engine object (with
// .desk and .state/.live on it), and resetServerDesks IS
// resetEngineObjects. There is exactly one cache, in
// engine-object.js — nothing here caches anything separately.
// live-state.js is likewise not a competing singleton: it is
// the state container the engine object owns.

export {
  createEngineObject,
  getEngineObject as getServerDesk,
  getEngineObject,
  resetEngineObjects as resetServerDesks,
  resetEngineObjects,
} from "./engine-object.js";
