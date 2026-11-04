// Home — the main screen is the chat, wrapped by the combined
// view (picked view-6: dashboard overview + companion card with
// orb glow outline + click-expand minimal dot detail).
//
// Live model, v1 — snapshot, then events, not refetches:
//   - On load, one snapshot fetch each from /api/engine,
//     /api/tools, /api/artifact, /api/agent and /api/soul.
//   - After that, the chat flow emits live events on the client
//     bus (src/lib/live-events.js: llm:start, llm:end, llm:error)
//     and the combined view subscribes — face, glow, status,
//     stats and feed update immediately on the event. There is
//     deliberately NO refetch after a chat reply.
//   - No server SSE stream is claimed here; that is a later step.
//
// The chat itself is unchanged in behaviour: one user query in,
// one LLM reply out, no loop, no streaming. If no model is
// present, the screen says so plainly and Send stays disabled.
// The model picker is still removed (the models store is the
// source of truth; an improved picker comes later). Server
// routes for models/inferences still exist, unused by this UI.
// No keys, no secrets: instructions always come from the desk
// on the server (personal/ first, public/defaults/ fallback);
// the client never sends them.
//
// The separate EngineLive / ToolsPanel / LiveArtifactPanel
// panels are superseded by the combined view, which renders
// their data in its dashboard, card, and expanded dot sections
// (Agent from desk.agent, Tools, Live Artifacts, Soul, History).
// The render-template DeskTemplate sections are likewise
// superseded by this combined view — feature/render-template
// is left alone for Kaushal to close, not rebased here.
"use client";

import { useCallback, useEffect, useState } from "react";
import CombinedView from "@/components/combined-view";
import SnapshotReplay from "@/components/snapshot-replay";
import { emitLiveEvent } from "@/lib/live-events.js";

async function fetchJson(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `${path} request failed`);
  }
  return body;
}

export default function Home() {
  const [live, setLive] = useState(null);
  const [toolsData, setToolsData] = useState(null);
  const [artifactData, setArtifactData] = useState(null);
  const [agentData, setAgentData] = useState(null);
  const [soulData, setSoulData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Snapshots (simulate agent) — minimal wiring only, no
  // card/glow/dashboard redesign. The list is loaded on demand,
  // replay is driven by a stored snapshot, never by the live run,
  // and replaying writes nothing (see /api/snapshots routes).
  const [snapshots, setSnapshots] = useState([]);
  const [replay, setReplay] = useState(null);
  const [snapshotError, setSnapshotError] = useState("");

  async function loadSnapshots() {
    try {
      const data = await fetchJson("/api/snapshots");
      setSnapshots(data.snapshots ?? []);
    } catch (err) {
      setSnapshotError(err.message);
    }
  }

  async function takeSnapshot() {
    setSnapshotError("");
    try {
      const response = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "snapshot failed");
      }
      await loadSnapshots();
    } catch (err) {
      setSnapshotError(err.message);
    }
  }

  async function openReplay(id) {
    setSnapshotError("");
    try {
      const data = await fetchJson(
        `/api/snapshots/${encodeURIComponent(id)}`,
      );
      setReplay(data.snapshot);
    } catch (err) {
      setSnapshotError(err.message);
    }
  }

  const loadSnapshot = useCallback(async () => {
    try {
      const [engine, tools, artifact, agent, soul] = await Promise.all([
        fetchJson("/api/engine"),
        fetchJson("/api/tools"),
        fetchJson("/api/artifact"),
        fetchJson("/api/agent"),
        fetchJson("/api/soul"),
      ]);
      setLive(engine);
      setToolsData(tools);
      setArtifactData(artifact);
      setAgentData(agent);
      setSoulData(soul);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  async function send() {
    const text = input.trim();
    if (!text || loading || !live?.hasDefault) {
      return;
    }
    setError("");
    const nextMessages = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    // Live event, not a refetch: the combined view updates its
    // face, glow, status, stats and feed on this event alone.
    emitLiveEvent("llm:start", {
      detail: "Model call — drafting the reply…",
    });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "chat request failed");
      }
      setMessages([
        ...nextMessages,
        { id: crypto.randomUUID(), role: "assistant", content: body.reply },
      ]);
      emitLiveEvent("llm:end", {
        detail: "Model call finished — reply received.",
      });
    } catch (err) {
      setError(err.message);
      emitLiveEvent("llm:error", {
        reason: err.message,
        detail: `LLM call failed: ${err.message}`,
      });
    } finally {
      setLoading(false);
      // Deliberately no loadSnapshot() here: the bus already
      // updated the live view. A refetch after a reply would
      // be the old fetch/manual pattern this view replaces.
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
            ASKK
          </span>
          <a
            href="/showcase"
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Components showcase
          </a>
        </div>

        {liveLoading && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connecting…
          </p>
        )}
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        <CombinedView
          live={live}
          soul={soulData}
          agent={agentData?.agent ?? null}
          toolsData={toolsData}
          artifactData={artifactData}
          messages={messages}
          input={input}
          setInput={setInput}
          onSend={send}
          loading={loading}
          error={error}
          liveLoading={liveLoading}
        />

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">Snapshots — simulate agent</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Take a snapshot of the current conversation and desk state,
            then replay it step by step. Replay shows the stored
            snapshot, not the live run, and writes nothing. Until the
            agent loop records thoughts and tool calls, a snapshot
            replays messages only — thinking and tool calls are
            labelled not captured, never invented.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={takeSnapshot}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm"
            >
              Take snapshot
            </button>
            <button
              type="button"
              onClick={loadSnapshots}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm"
            >
              List snapshots
            </button>
          </div>
          {snapshotError && (
            <p className="mt-2 text-sm text-red-600">{snapshotError}</p>
          )}
          {snapshots.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {snapshots.map((snap) => (
                <li key={snap.id} className="flex items-baseline justify-between gap-4">
                  <span>
                    {snap.id} · {snap.at} · {snap.stepCount} steps ·{" "}
                    {snap.progress}
                    {snap.partial ? " · partial" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => openReplay(snap.id)}
                    className="font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Replay
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {replay ? (
          <SnapshotReplay snapshot={replay} onClose={() => setReplay(null)} />
        ) : null}
      </main>
    </div>
  );
}
