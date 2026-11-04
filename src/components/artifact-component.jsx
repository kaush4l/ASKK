// Artifact component — an artifact's own live UI, by kind.
// Watcher and script are artifact kinds here, goal is an
// artifact kind, generic is the plain kind. Each kind renders
// its own defined state attributes first; SnapshotValue is
// only the fallback for fields the kind does not define.
//
// Props: { snapshot, signal }. When a signal is given, the
// component subscribes to it itself (useLiveState) and
// re-renders on signal change — signal -> DOM, no refetch.
"use client";

import SnapshotValue from "@/components/snapshot-value";
import { useLiveState } from "@/lib/use-live-state";

function Field({ label, children }) {
  return (
    <p className="text-sm">
      <span className="text-xs font-medium text-zinc-500">{label}: </span>
      {children}
    </p>
  );
}

export default function ArtifactComponent({ snapshot, signal }) {
  const live = useLiveState(signal, snapshot) ?? snapshot ?? {};
  const attrs = live.attributes ?? live;
  const kind = live.artifactKind ?? attrs.artifactKind ?? "generic";
  const steps = Array.isArray(attrs.steps) ? attrs.steps : [];
  const doneSteps = steps.filter((s) => s.done).length;
  return (
    <section
      data-testid={`artifact-component-${live.id ?? "artifact"}`}
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
          Artifact: {live.id ?? "artifact"}
        </h3>
        <span className="text-xs text-zinc-500">
          {kind}
          {live.lifecycle ? ` · ${live.lifecycle}` : ""}
        </span>
      </div>
      {kind === "goal" && (
        <>
          <Field label="Statement">
            {attrs.statement ?? live.statement ?? "—"}
          </Field>
          <Field label="Status">{attrs.status ?? live.status ?? "—"}</Field>
          <Field label="Steps">
            {doneSteps} of {steps.length} done
          </Field>
          {(attrs.report ?? live.report) ? (
            <Field label="Report">{attrs.report ?? live.report}</Field>
          ) : null}
        </>
      )}
      {kind === "script" && (
        <>
          <Field label="Trigger">{attrs.trigger ?? "—"}</Field>
          <Field label="Run status">{attrs.runStatus ?? "—"}</Field>
          <Field label="Commands">
            {Array.isArray(attrs.commands) ? attrs.commands.join(", ") : "—"}
          </Field>
          {attrs.doneNotification ? (
            <Field label="Done notification">{attrs.doneNotification}</Field>
          ) : null}
        </>
      )}
      {kind === "watcher" && (
        <>
          <Field label="Watch">{attrs.watch ?? "—"}</Field>
          <Field label="Event">{attrs.event ?? "—"}</Field>
          <Field label="Started">{attrs.started ? "yes" : "no"}</Field>
          <Field label="Last event">
            {attrs.lastEvent ? JSON.stringify(attrs.lastEvent) : "—"}
          </Field>
        </>
      )}
      {kind === "generic" && (
        <>
          {attrs.title ? <Field label="Title">{attrs.title}</Field> : null}
          {attrs.content ? (
            <Field label="Content">{attrs.content}</Field>
          ) : null}
          {!attrs.title && !attrs.content ? (
            <div className="text-sm">
              <SnapshotValue value={live} />
            </div>
          ) : null}
        </>
      )}
      {live.expanded !== undefined ? (
        <Field label="Expanded">{live.expanded ? "yes" : "no"}</Field>
      ) : null}
      {/* Fallback only: history and any undefined-kind fields. */}
      {Array.isArray(live.history) && live.history.length > 0 ? (
        <div className="text-sm">
          <span className="text-xs font-medium text-zinc-500">History: </span>
          <SnapshotValue value={live.history.slice(-5)} />
        </div>
      ) : null}
    </section>
  );
}
