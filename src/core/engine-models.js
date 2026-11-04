// Engine models — the models actions go through the SINGLE live
// engine object, never through a second seed.
//
// Before Milestone 2, /api/models kept its own module-level
// memoryStore, seeded once from a fresh desk snapshot, and the
// models page seeded its own copy from /api/desk-snapshot. Two
// seeds could drift if the template file changed mid-session,
// and persistence was never verified without a personal/ folder.
//
// Now there is exactly one models store: engine._models, seeded
// once from the desk snapshot (personal/memory/model.json wins,
// else public/defaults/memory/model.json — the desk reader's
// per-file fallback) and held on the engine object itself.
// getEngineModels(engine) returns that same object on every
// call; applyEngineModelsAction(engine, action) mutates it in
// place, syncs the engine signal, and persists it to
// <desk.location>/memory/model.json when that desk folder
// exists — otherwise the action stays in-memory for the server
// process and the result says persisted: false plainly, exactly
// as before. Nothing is ever written to public/defaults/.
//
// This is the PROVIDERS template store (the models page list).
// It is NOT the chat inference list: /api/inferences writes
// personal/model.json (the desk's inference list, whose order
// is the chat default, changed via /api/inferences/default).
// Those are two different lists by design — see PR.md's route
// audit — and this module does not pretend to unify them.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDeskSnapshot } from "./desk-reader.js";
import { applyProviderAction, listProviders } from "./providers.js";

export function getEngineModels(engine) {
  if (!engine || typeof engine !== "object") {
    throw new Error("engine models need an engine object");
  }
  if (!engine._models) {
    let seed = [];
    try {
      const snap = readDeskSnapshot({
        personalDir: engine.desk?.location,
        defaultsDir: `${process.cwd()}/public/defaults`,
        agent: "developer",
      });
      seed = snap.models ?? [];
    } catch {
      seed = [];
    }
    const listed = listProviders(seed);
    engine._models = {
      providers: seed,
      defaultId: listed.default?.id ?? null,
    };
  }
  return engine._models;
}

export function applyEngineModelsAction(engine, action) {
  const store = getEngineModels(engine);
  const { state, result } = applyProviderAction(store, action);
  store.providers = state.providers;
  store.defaultId = state.defaultId;
  let persisted = false;
  const dir = engine.desk?.location;
  if (typeof dir === "string" && dir !== "" && existsSync(dir)) {
    try {
      mkdirSync(join(dir, "memory"), { recursive: true });
      writeFileSync(
        join(dir, "memory", "model.json"),
        `${JSON.stringify(state.providers, null, 2)}\n`,
        "utf8",
      );
      persisted = true;
    } catch {
      persisted = false;
    }
  }
  if (typeof engine.signal?.set === "function") {
    try {
      engine.signal.set(engine.snapshot());
    } catch {
      // Signal sync is best-effort; the store mutation above is
      // authoritative and already visible through getEngineModels.
    }
  }
  return {
    ...result,
    providers: state.providers.map((entry) => ({
      ...entry,
      isDefault: state.defaultId
        ? entry.id === state.defaultId
        : Boolean(entry.isDefault),
    })),
    defaultId: state.defaultId,
    persisted,
    ...(persisted
      ? {}
      : {
          note: "not persisted: no personal desk folder; in-memory only for this server process",
        }),
  };
}
