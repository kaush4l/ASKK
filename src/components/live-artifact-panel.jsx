// Live artifact panel — show the artifact the default agent holds,
// and expand it for more details.
//
// Loads GET /api/artifact on mount: the artifact twin (id, root,
// open files, focus, modified), bounded previews of the open files,
// and parsed history entries. No keys, no absolute paths. The route
// is read-only: viewing this panel writes no history and no state.
// The agent-side expand() is a core method, not a route — a future
// loop will call it, and it will record artifact.expand then.
"use client";

import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export default function LiveArtifactPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/artifact")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "artifact request failed");
        }
        if (!cancelled) {
          setData(body);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold">Live artifact</h2>
      {!data && !error && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Loading artifact…
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <>
          <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            <span>
              id: <span className="font-mono">{data.artifact.id}</span>
              {" · "}root:{" "}
              {data.artifact.root === "" ? "workspace" : data.artifact.root}
              {" · "}open:{" "}
              {data.artifact.open.length === 0
                ? "none"
                : data.artifact.open.join(", ")}
            </span>
            <span>
              focus:{" "}
              {data.artifact.focus
                ? `${data.artifact.focus.path}${
                    data.artifact.focus.from
                      ? ` (lines ${data.artifact.focus.from}–${data.artifact.focus.from + (data.artifact.focus.lines ?? 1) - 1})`
                      : ""
                  }`
                : "none"}
              {" · "}modified:{" "}
              {data.artifact.modified.length === 0
                ? "none"
                : data.artifact.modified
                    .map((entry) => `${entry.path} (${entry.op})`)
                    .join(", ")}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {data.openFiles.map((file) => {
              const key = `file:${file.path}`;
              const isOpen = Boolean(open[key]);
              return (
                <Collapsible
                  key={key}
                  open={isOpen}
                  onOpenChange={() => toggle(key)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <span aria-hidden>{isOpen ? "▾" : "▸"}</span>
                    <span className="font-mono font-medium">{file.path}</span>
                    <span className="text-zinc-500">
                      {file.gone
                        ? "gone from disk"
                        : `${file.lines} lines${file.truncated ? " (preview truncated)" : ""}`}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-3 text-sm">
                    {file.gone ? (
                      <p className="text-zinc-500">
                        This file was open when the artifact was saved but is no
                        longer on disk.
                      </p>
                    ) : (
                      <pre className="overflow-auto whitespace-pre-wrap text-xs leading-5">
                        {file.preview}
                      </pre>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>

          <h3 className="text-sm font-semibold">
            History {data.history.length > 0 && `(${data.history.length})`}
          </h3>
          {data.history.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No agent actions recorded yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.history.map((entry, index) => {
                const key = `history:${index}`;
                const isOpen = Boolean(open[key]);
                return (
                  <Collapsible
                    key={key}
                    open={isOpen}
                    onOpenChange={() => toggle(key)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800"
                  >
                    <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <span aria-hidden>{isOpen ? "▾" : "▸"}</span>
                      <span className="font-mono font-medium">
                        {entry.action}
                      </span>
                      <span className="text-zinc-500">{entry.timestamp}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex flex-col gap-1 px-3 pb-3 text-sm">
                      <div>agent: {entry.agent}</div>
                      {entry.path && <div>path: {entry.path}</div>}
                      <div>detail: {entry.detail}</div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
