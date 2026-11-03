// Desk render template — one template that renders a desk/agent
// view with the same elements as the old app, in this order:
//   Soul, Agent, History, Tools, Live Artifacts, Skills.
//
// NOT YET WIRED INTO page.js — wiring is the rebase step, done
// after feature/live-artifact merges, when page.js is free. The
// rebase step calls templateData(desk, messages) from
// src/core/render-template.js and passes its result here:
//
//   const props = templateData(desk, messages);
//   <DeskTemplate {...props} />
//
// Props (all optional, all with safe defaults — see templateData):
//   soul: { instructions, source, preview } — full instructions
//     text from personal/instructions.md via the desk loader's
//     personal/public fallback, never a hardcoded string.
//   agent: { model, provider, endpoint, status, hasDefault,
//     inferenceCount, messageCount, instructionsPreview } — the
//     live engine object shape from GET /api/engine. No keys.
//   history: { session: [{ role, content }], agent: [{
//     timestamp, action, agent, path, detail }] } — TWO histories,
//     clearly labelled, never merged: session chat history, and
//     agent history from parsed history.md entries. No entries
//     are invented; an absent agent history renders as
//     "No agent history yet".
//   tools: { list: [{ name, description, input, expectation,
//     type }], files, terminal } — the GET /api/tools shape.
//   liveArtifacts: [{ id, root, treeCount, open, focus, modified }]
//     — desk artifact twins. Absent artifacts render as
//     "No live artifact yet", never as a fake artifact.
//   skills: [] — PLACEHOLDER ONLY. Skills will be added later;
//     see src/components/skills-panel.jsx.
//   messages: [{ role, content }] — the session messages, the
//     same list as history.session, kept as a top-level prop for
//     the chat rendering the page already does.
//
// This is a presentational template: it fetches nothing itself.
// The page passes data in. Tools rendering below follows the
// tools-panel spec shape inline; tools-panel itself fetches
// /api/tools, so it cannot be imported here without breaking
// that rule — the duplication is noted here to be unified at
// rebase time, when the template is wired in.
"use client";

import { useState } from "react";
import SkillsPanel from "@/components/skills-panel.jsx";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 px-4 pb-4 text-sm">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ExpectationBadge({ expectation }) {
  const tone =
    expectation === "done"
      ? "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100"
      : expectation === "stream"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
        : expectation === "live-state"
          ? "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100"
          : "";
  return (
    <Badge variant="secondary" className={cn(tone)}>
      {expectation}
    </Badge>
  );
}

function SoulSection({ soul }) {
  const instructions = soul?.instructions ?? "";
  const preview = soul?.preview ?? instructions.split(/\r?\n/)[0] ?? "";
  return (
    <Section title="Soul">
      <p className="text-zinc-600 dark:text-zinc-400">
        {preview || "No instructions configured."}
      </p>
      {instructions && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer text-zinc-500">
            Full instructions ({soul?.source ?? "public"})
          </summary>
          <pre className="whitespace-pre-wrap break-words text-sm">
            {instructions}
          </pre>
        </details>
      )}
    </Section>
  );
}

function AgentSection({ agent }) {
  const ready = Boolean(agent?.hasDefault);
  return (
    <Section title="Agent">
      <dl className="flex flex-col gap-1">
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-zinc-500">Status</dt>
          <dd>{agent?.status ?? (ready ? "Ready" : "No model configured")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-zinc-500">Model</dt>
          <dd>{agent?.model ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-zinc-500">Provider</dt>
          <dd>{agent?.provider ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-zinc-500">Endpoint</dt>
          <dd className="break-all">{agent?.endpoint ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-zinc-500">Models in store</dt>
          <dd>{agent?.inferenceCount ?? 0}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 shrink-0 text-zinc-500">Messages</dt>
          <dd>{agent?.messageCount ?? 0}</dd>
        </div>
      </dl>
    </Section>
  );
}

function HistorySection({ history }) {
  const session = Array.isArray(history?.session) ? history.session : [];
  const agentHistory = Array.isArray(history?.agent) ? history.agent : [];
  return (
    <Section title="History">
      <h3 className="font-medium">Session history</h3>
      {session.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No session messages yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {session.map((message, index) => (
            <li
              key={`${message.role}-${index}`}
              className="flex flex-col gap-1"
            >
              <span className="font-mono text-xs text-zinc-500">
                {message.role}
              </span>
              <span className="whitespace-pre-wrap">{message.content}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-medium">Agent history</h3>
      {agentHistory.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No agent history yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {agentHistory.map((entry, index) => (
            <li
              key={`${entry.timestamp}-${entry.action}-${index}`}
              className="flex flex-col gap-1"
            >
              <span>
                {entry.timestamp ? `${entry.timestamp} · ` : ""}
                {entry.action}
              </span>
              <span className="text-zinc-500">
                {entry.agent}
                {entry.path ? ` · ${entry.path}` : ""}
                {entry.detail ? ` — ${entry.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ToolsSection({ tools }) {
  const list = Array.isArray(tools?.list) ? tools.list : [];
  const [open, setOpen] = useState({});
  return (
    <Section title={`Tools${list.length ? ` (${list.length})` : ""}`}>
      {list.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No tools loaded.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {tools?.files && (
            <p className="text-zinc-600 dark:text-zinc-400">
              Files root:{" "}
              {tools.files.root === "" ? "workspace" : tools.files.root}
              {tools.files.open?.length > 0 &&
                ` · open: ${tools.files.open.join(", ")}`}
              {tools.files.focus && ` · focus: ${tools.files.focus.path}`}
            </p>
          )}
          {tools?.terminal && (
            <p className="text-zinc-600 dark:text-zinc-400">
              Terminal sessions:{" "}
              {tools.terminal.sessions?.length === 0
                ? "none"
                : tools.terminal.sessions
                    .map((s) => `${s.id} ${s.command} (${s.status})`)
                    .join(", ")}
            </p>
          )}
          {list.map((tool) => {
            const isOpen = Boolean(open[tool.name]);
            return (
              <Collapsible
                key={tool.name}
                open={isOpen}
                onOpenChange={(next) =>
                  setOpen((prev) => ({ ...prev, [tool.name]: next }))
                }
                className="rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <span aria-hidden>{isOpen ? "▾" : "▸"}</span>
                  <span className="font-mono font-medium">{tool.name}</span>
                  <ExpectationBadge expectation={tool.expectation} />
                  <span className="truncate text-zinc-500">
                    {tool.description}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
                  <p>{tool.description}</p>
                  <p className="text-zinc-500">
                    Inputs:{" "}
                    {tool.input && Object.entries(tool.input).length > 0
                      ? Object.entries(tool.input)
                          .map(([field, meaning]) => `${field}: ${meaning}`)
                          .join("; ")
                      : "none"}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function LiveArtifactsSection({ liveArtifacts }) {
  const artifacts = Array.isArray(liveArtifacts) ? liveArtifacts : [];
  return (
    <Section title="Live Artifacts">
      {artifacts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No live artifact yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {artifacts.map((artifact) => (
            <li
              key={artifact.id ?? artifact.root}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <span className="font-mono font-medium">{artifact.id}</span>
              <span className="text-zinc-500">
                root: {artifact.root === "" ? "workspace" : artifact.root}
                {artifact.treeCount != null &&
                  ` · ${artifact.treeCount} entries`}
              </span>
              <span>
                open:{" "}
                {artifact.open?.length > 0 ? artifact.open.join(", ") : "none"}
              </span>
              <span>
                focus: {artifact.focus ? artifact.focus.path : "none"}
              </span>
              <span>
                modified:{" "}
                {artifact.modified?.length > 0
                  ? artifact.modified.map((m) => m.path).join(", ")
                  : "none"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function DeskTemplate({
  soul,
  agent,
  history,
  tools,
  liveArtifacts,
  skills,
  messages,
}) {
  // messages is the session list, identical to history.session;
  // it is kept as a prop for the page's chat rendering. The
  // History section renders history.session, so a page that only
  // passes messages still shows them via templateData.
  const session = Array.isArray(history?.session)
    ? history.session
    : Array.isArray(messages)
      ? messages
      : [];
  return (
    <div className="flex flex-col gap-3">
      <SoulSection soul={soul} />
      <AgentSection agent={agent} />
      <HistorySection history={{ session, agent: history?.agent ?? [] }} />
      <ToolsSection tools={tools} />
      <LiveArtifactsSection liveArtifacts={liveArtifacts} />
      <Section title="Skills">
        <SkillsPanel skills={skills} />
      </Section>
    </div>
  );
}
