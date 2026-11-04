// Agent card — renders agent state from a desk snapshot prop.
// It renders ONLY fields present in the snapshot (see
// src/core/ui-data.js agentCardData): if no cycles exist, no
// cycles panel appears; if a tool/phase/agent appears in the
// snapshot, a row/card appears for it. No hardcoded panels,
// tool lists, or agent names live in this component.
"use client";

import { agentCardData } from "@/core/ui-data.js";

export default function AgentCard({ snapshot }) {
  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No live snapshot yet — the card renders from the live desk snapshot
          once it loads.
        </p>
      </section>
    );
  }
  const data = agentCardData(snapshot);
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-base">Agent</span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {data.activity}
        </span>
      </div>
      {data.sections.length === 0 && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Idle — nothing in the snapshot to show.
        </p>
      )}
      {data.sections.map((section) => {
        if (section.kind === "agents") {
          return (
            <div key="agents" className="mt-3">
              {section.agents.map((agent) => (
                <p key={agent.name} className="text-sm">
                  {agent.name} · {agent.status}
                  {agent.currentPhase ? ` · phase: ${agent.currentPhase}` : ""}
                  {agent.goal ? ` · goal: ${agent.goal}` : ""}
                </p>
              ))}
            </div>
          );
        }
        if (section.kind === "calls") {
          return (
            <div key="calls" className="mt-3">
              {section.groups.map((group) => (
                <div key={group.group}>
                  <p className="text-xs font-medium text-zinc-500">
                    {group.group === "sequential"
                      ? "Tool calls"
                      : `Parallel group ${group.group}`}
                  </p>
                  {group.calls.map((call) => (
                    <p key={call.id} className="font-mono text-sm">
                      {call.name} · {call.status}
                      {call.partial ? " · partial" : ""}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          );
        }
        if (section.kind === "goals") {
          return (
            <div key="goals" className="mt-3">
              {section.goals.map((goal) => (
                <p key={goal.id} className="text-sm">
                  Goal {goal.id}: {goal.statement} [{goal.status}]
                </p>
              ))}
            </div>
          );
        }
        if (section.kind === "phases") {
          return (
            <div key="phases" className="mt-3">
              {section.phases.map((phase) => (
                <p key={phase.id} className="text-sm">
                  Phase {phase.id}: {phase.duty} [{phase.status}]
                </p>
              ))}
            </div>
          );
        }
        if (section.kind === "tools") {
          return (
            <p
              key="tools"
              className="mt-3 text-sm text-zinc-600 dark:text-zinc-400"
            >
              Tools: {section.tools.join(", ")}
            </p>
          );
        }
        if (section.kind === "artifact") {
          return (
            <p
              key="artifact"
              className="mt-3 text-sm text-zinc-600 dark:text-zinc-400"
            >
              Artifact — open: {section.artifact.open.join(", ") || "none"}
              {section.artifact.focus
                ? ` · focus: ${section.artifact.focus.path ?? section.artifact.focus}`
                : ""}
            </p>
          );
        }
        return null;
      })}
    </section>
  );
}
