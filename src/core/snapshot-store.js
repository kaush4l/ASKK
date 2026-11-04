// Snapshot storage — Node fs only. Pure shape lives in
// src/core/snapshot.js; this module only reads/writes files.
//
// Layout, personal ONLY, never public/defaults/:
//   <personalDir>/memory/agent/<agentId>/snapshots/<id>.json
//   <personalDir>/memory/agent/<id>/snapshots/<id>.md  (summary)
//
// Writing a snapshot writes ONLY these two files. It never
// rewrites state.md, never appends to history.md, and never
// touches public/defaults/ — a public template snapshot would
// be empty/partial only, so none is shipped. Reading a snapshot
// (list or full) writes nothing at all, mirroring the GET
// /api/artifact rule: read-only replay creates no history entry
// and writes no state.
//
// Writes are atomic: JSON is written to a tmp file in the same
// directory and renamed over the target, so a snapshot is never
// observed half-written. The desk instance that takes the
// snapshot is the single instance: captureFromDesk reads its
// live twin/artifact/tools at that moment and deep-copies them,
// so later live changes never rewrite the stored snapshot.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  checkSnapshotId,
  createSnapshot,
  deepCopy,
  normalizeArtifactState,
  sanitizeDeskTwin,
  snapshotToMarkdown,
  toolsVersion,
} from "./snapshot.js";

export function snapshotsDir(personalDir, agentId = "default") {
  const base = isAbsolute(personalDir)
    ? personalDir
    : join(/* turbopackIgnore: true */ process.cwd(), personalDir);
  return join(base, "memory", "agent", checkSnapshotId(agentId), "snapshots");
}

export function saveSnapshot(personalDir, snapshot, agentId = "default") {
  const frozen = createSnapshot(snapshot);
  const dir = snapshotsDir(personalDir, agentId);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, `${frozen.id}.json`);
  const tmpPath = `${jsonPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  renameSync(tmpPath, jsonPath);
  writeFileSync(
    join(dir, `${frozen.id}.md`),
    snapshotToMarkdown(frozen),
    "utf8",
  );
  return deepCopy(frozen);
}

export function listSnapshots(personalDir, agentId = "default") {
  const dir = snapshotsDir(personalDir, agentId);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      try {
        return createSnapshot(
          JSON.parse(readFileSync(join(dir, name), "utf8")),
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function loadSnapshot(personalDir, id, agentId = "default") {
  const checked = checkSnapshotId(id);
  const file = join(snapshotsDir(personalDir, agentId), `${checked}.json`);
  if (!existsSync(file)) {
    return null;
  }
  return createSnapshot(JSON.parse(readFileSync(file, "utf8")));
}

// Build a snapshot from the single live desk instance at this
// moment. deskTwin, soul/tools versions, and artifact state are
// derived from the desk object actually present — never from a
// hardcoded list, and never from another element's data:
//   - deskTwin: the desk default inference (model/provider/
//     endpoint) plus status and inference count.
//   - soulVersion: the instructions source the desk carries
//     ("personal" or "public") — a source label, not soul text.
//   - toolsVersion: a hash of the live registry's specs.
//   - artifactState: the live artifact twin's open/focus/
//     modified, as logical paths only.
// Messages/steps supplied by the caller (the session holder) are
// deep-copied in; steps default to one message-step per message
// when no steps are supplied, with thought null and no calls —
// labelled not captured in replay, never invented.
export function captureFromDesk(desk, input = {}) {
  const defaultInference = desk?.defaultInference ?? null;
  const twin = sanitizeDeskTwin({
    model: defaultInference?.model ?? desk?.engine?.model ?? "",
    provider: defaultInference?.provider ?? "",
    endpoint: defaultInference?.endpoint ?? "",
    status: defaultInference ? "ready" : "no-model",
    inferenceCount: (desk?.inferences ?? []).length,
  });
  const artifact = desk?.liveArtifact?.twin?.() ?? null;
  const artifactState = normalizeArtifactState({
    open: artifact?.open ?? [],
    focus: artifact?.focus ?? null,
    modified: artifact?.modified ?? [],
  });
  return createSnapshot({
    ...(input.id ? { id: input.id } : {}),
    ...(input.at ? { at: input.at } : {}),
    deskTwin: twin,
    messages: input.messages ?? [],
    steps: input.steps ?? [],
    soulVersion: `soul:${desk?.engine?.metadata?.source ?? "public"}`,
    toolsVersion: toolsVersion(
      typeof desk?.listTools === "function" ? desk.listTools() : [],
    ),
    artifactState,
    ...(input.progress ? { progress: input.progress } : {}),
    ...(typeof input.partial === "boolean" ? { partial: input.partial } : {}),
  });
}
