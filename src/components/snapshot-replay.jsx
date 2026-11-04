// Snapshot replay — the simulate agent's replay view, driven by
// a STORED snapshot, never by the live run.
//
// A snapshot is a frozen capture: replaying it shows what was
// captured, step by step, in order — message, thinking, tool
// call, context at that time — and it never re-runs the model,
// never refetches live state, and never rewrites live state.
// That is why a replay can show a run that has since moved on,
// and why a snapshot taken mid-run replays only up to where it
// was taken (marked partial).
//
// Feed-row rules, reused from the combined view:
//   - One line first, detail on expand (Collapsible).
//   - Stable call ids (the snapshot's own call ids, rendered
//     verbatim — they are the identity of a call across views).
//   - Colour + shape + word, never colour alone: glyph + words
//     + the same colour system (LLM sky, tool violet, success
//     emerald, error red, waiting amber, idle grey).
//   - Failed steps stay visible, marked, with a plain reason
//     (the call result, when one was recorded).
//   - Honesty label per step, from src/core/snapshot.js:
//     "Context at this step" when no later step in this snapshot
//     changed the artifact, otherwise "now — N later calls
//     changed it since (within this snapshot)".
//   - What was not captured is labelled "not captured at this
//     step", never invented: thinking when no thought field was
//     recorded, terminal streams (only final lines as a tool
//     result are replayable), model internal state (never part
//     of a snapshot), and external changes after a step.
//   - This component renders whatever steps, calls, and artifact
//     state the snapshot actually contains — it does not assume
//     a tool, a desk organisation, or a step count in advance.
//     A snapshot with no steps replays its messages only, and
//     says so plainly, rather than inventing steps.
"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { honestyLabel, notCapturedLabels } from "@/core/snapshot.js";

const PHASE = {
  idle: { glyph: "○", color: "#9ca3af", label: "Idle" },
  llm: { glyph: "◐", color: "#0ea5e9", label: "LLM" },
  tool: { glyph: "◆", color: "#8b5cf6", label: "Tool" },
  waiting: { glyph: "◌", color: "#f59e0b", label: "Waiting" },
  error: { glyph: "✕", color: "#ef4444", label: "Error" },
  success: { glyph: "✓", color: "#10b981", label: "Success" },
};

function phaseOf(activity) {
  return PHASE[activity] ?? PHASE.idle;
}

export default function SnapshotReplay({ snapshot, onClose }) {
  if (!snapshot) {
    return null;
  }
  const steps = snapshot.steps ?? [];
  const messages = snapshot.messages ?? [];
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold">Replay — {snapshot.id}</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Close replay
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Taken {snapshot.at} · {messages.length} messages · {steps.length}{" "}
        steps · {snapshot.progress}
        {snapshot.partial
          ? " · partial — ends where it was taken, not at success"
          : ""}
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Desk at capture: {snapshot.deskTwin?.provider ?? ""}{" "}
        {snapshot.deskTwin?.model ?? ""} ({snapshot.deskTwin?.status ?? ""})
        — this is the snapshot&apos;s frozen desk, not the live desk.
      </p>

      {steps.length === 0 ? (
        <p className="mt-3 text-sm">
          No steps were captured in this snapshot — replaying its messages
          only:
        </p>
      ) : null}
      {steps.length === 0 &&
        messages.map((message, i) => (
          <p key={i} className="mt-2 text-sm">
            <b>{message.role}:</b> {message.content}
          </p>
        ))}

      <ol className="mt-3 flex flex-col gap-3">
        {steps.map((step, i) => {
          const phase = phaseOf(step.activity);
          const firstCall = step.calls?.[0];
          const oneLine = firstCall
            ? `${firstCall.name} — ${firstCall.result || "no result recorded"}`
            : step.message
              ? `${step.message.role}: ${step.message.content}`
              : "No tool call at this step";
          const labels = notCapturedLabels(step);
          return (
            <li
              key={step.calls?.[0]?.id ?? `step-${step.step}`}
              className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <p className="text-sm">
                <span style={{ color: phase.color }}>
                  {phase.glyph} {phase.label}
                </span>{" "}
                <b>Step {step.step}</b> — {oneLine}
                {step.activity === "error" ? (
                  <span className="text-red-600"> · failed step, kept visible</span>
                ) : null}
              </p>
              <Collapsible>
                <CollapsibleTrigger className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Show detail for step {step.step}
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {step.message ? (
                    <p>
                      <b className="text-black dark:text-zinc-50">Message:</b>{" "}
                      {step.message.role}: {step.message.content}
                    </p>
                  ) : (
                    <p>No message at this step.</p>
                  )}
                  {step.thought ? (
                    <p>
                      <b className="text-black dark:text-zinc-50">Thinking:</b>{" "}
                      {step.thought}
                    </p>
                  ) : (
                    <p>
                      <b className="text-black dark:text-zinc-50">Thinking:</b>{" "}
                      Thinking: not captured at this step — no thought field
                      was recorded for this step, so no thought is shown
                      rather than an invented one.
                    </p>
                  )}
                  {step.calls?.length ? (
                    step.calls.map((call) => (
                      <p key={call.id}>
                        <b className="text-black dark:text-zinc-50">
                          Tool call:
                        </b>{" "}
                        {call.name}
                        {call.expectation ? ` (${call.expectation})` : ""} ·
                        id {call.id}
                        <br />
                        Inputs: {call.inputs || "—"}
                        <br />
                        Result: {call.result || "—"}
                      </p>
                    ))
                  ) : (
                    <p>No tool call at this step.</p>
                  )}
                  <p>
                    <b className="text-black dark:text-zinc-50">
                      Context at that time:
                    </b>{" "}
                    soul {step.context?.soulVersion ?? "—"} · tools{" "}
                    {step.context?.toolsVersion ?? "—"}
                    <br />
                    Artifact: open{" "}
                    {step.context?.artifactState?.open?.length
                      ? step.context.artifactState.open.join(", ")
                      : "none"}{" "}
                    · focus {step.context?.artifactState?.focus ?? "none"} ·
                    modified{" "}
                    {step.context?.artifactState?.modified?.length
                      ? step.context.artifactState.modified.join(", ")
                      : "none"}
                    <br />
                    Activity: {step.activity} · Counts: LLM{" "}
                    {step.counts?.llm ?? 0} · tool {step.counts?.tool ?? 0} ·
                    success {step.counts?.ok ?? 0} · errors{" "}
                    {step.counts?.err ?? 0}
                  </p>
                  <p>
                    <b className="text-black dark:text-zinc-50">
                      Honesty label:
                    </b>{" "}
                    {honestyLabel(snapshot, i)}
                  </p>
                  {labels.map((label) => (
                    <p key={label} className="text-amber-800">
                      {label}
                    </p>
                  ))}
                  <p>
                    Snapshot: {snapshot.id} · step {step.step} of{" "}
                    {steps.length}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
