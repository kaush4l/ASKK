// Tools panel — show the tools the default agent loads, and
// expand each one for more details.
//
// Loads GET /api/tools on mount: plain specs (name, description,
// input, expectation) plus live state (files: root, open files,
// focus; terminal: sessions). No web tools appear here — web is
// ignored for now, and the registry contains none. Tools are
// loaded, listed, and shown; the single-turn chat does not invoke
// them yet (tool-calling by the LLM is a later feature).
"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

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

export default function ToolsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tools")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "tools request failed");
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

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold">
        Tools {data ? `(${data.tools.length})` : ""}
      </h2>
      {!data && !error && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Loading tools…
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <>
          <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            <span>
              Files root:{" "}
              {data.files.root === "" ? "workspace" : data.files.root}
              {data.files.open.length > 0 &&
                ` · open: ${data.files.open.join(", ")}`}
              {data.files.focus &&
                ` · focus: ${data.files.focus.path}${
                  data.files.focus.from
                    ? ` (lines ${data.files.focus.from}–${data.files.focus.from + data.files.focus.lines - 1})`
                    : ""
                }`}
            </span>
            <span>
              Terminal sessions:{" "}
              {data.terminal.sessions.length === 0
                ? "none"
                : data.terminal.sessions
                    .map(
                      (session) =>
                        `${session.id} ${session.command} (${session.status})`,
                    )
                    .join(", ")}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {data.tools.map((tool) => {
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
                  <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <span aria-hidden>{isOpen ? "▾" : "▸"}</span>
                    <span className="font-mono font-medium">{tool.name}</span>
                    <ExpectationBadge expectation={tool.expectation} />
                    <span className="truncate text-zinc-500">
                      {tool.description}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3 text-sm">
                    <p>{tool.description}</p>
                    <dl className="flex flex-col gap-1">
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-zinc-500">Type</dt>
                        <dd>{tool.type}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-zinc-500">
                          Expectation
                        </dt>
                        <dd>{tool.expectation}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-zinc-500">Inputs</dt>
                        <dd>
                          {Object.entries(tool.input).length === 0
                            ? "none"
                            : Object.entries(tool.input).map(
                                ([field, meaning]) => (
                                  <div key={field}>
                                    <span className="font-mono">{field}</span>
                                    {": "}
                                    {meaning}
                                  </div>
                                ),
                              )}
                        </dd>
                      </div>
                      {tool.name.startsWith("files.") && (
                        <div className="flex gap-2">
                          <dt className="w-24 shrink-0 text-zinc-500">State</dt>
                          <dd>
                            root:{" "}
                            {data.files.root === ""
                              ? "workspace"
                              : data.files.root}
                            {"; "}open:{" "}
                            {data.files.open.length === 0
                              ? "none"
                              : data.files.open.join(", ")}
                            {"; "}focus:{" "}
                            {data.files.focus ? data.files.focus.path : "none"}
                          </dd>
                        </div>
                      )}
                      {tool.name.startsWith("terminal.") && (
                        <div className="flex gap-2">
                          <dt className="w-24 shrink-0 text-zinc-500">
                            Sessions
                          </dt>
                          <dd>
                            {data.terminal.sessions.length === 0
                              ? "none"
                              : data.terminal.sessions
                                  .map(
                                    (session) =>
                                      `${session.id} ${session.command} (${session.status})`,
                                  )
                                  .join(", ")}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
