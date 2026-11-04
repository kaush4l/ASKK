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
// Milestone 2: the dashboard chat IS the harness entry now.
// send() posts { request } to /api/harness (harness -> one
// goal.create -> developer plan -> execute -> critique ->
// report back), and the reply shown is the developer's report.
// The old single-turn /api/chat route was DELETED in Milestone 4 and is no
// longer called from this page. If no model is present, the
// screen says so plainly and Send stays disabled.
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
// The DeskTemplate sections (render-template.js, deleted in Milestone 4) are likewise
// superseded by this combined view
// is left alone for Kaushal to close, not rebased here.
"use client";

import { useCallback, useEffect, useState } from "react";
import AgentCard from "@/components/agent-card";
import CombinedView from "@/components/combined-view";
import LiveCanvas from "@/components/live-canvas";
import LiveStatus from "@/components/live-status";
import { emitLiveEvent, subscribeLiveEvent } from "@/lib/live-events.js";
import { createSignal } from "@/lib/signals.js";
import { useLiveState } from "@/lib/use-live-state.js";

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
  // Engine signal (live-agent section only): one client-side
  // signal holding the engine snapshot, fed by /api/engine-object
  // (the server's single engine object, current state on every
  // call) and by the client live-event bus. Components below
  // subscribe to it and re-render on state change only — no
  // polling, no refresh re-render. Honest boundary: there is no
  // server push (no SSE/WebSocket); across HTTP, the next route
  // call returns the same engine object's current state.
  const [engineSignal] = useState(() => createSignal(null));
  const engineSnapshot = useLiveState(engineSignal, null);
  const [engineError, setEngineError] = useState("");
  const loadEngine = useCallback(async () => {
    try {
      const body = await fetchJson("/api/engine-object");
      const state = body.state ?? {};
      engineSignal.set({
        id: "engine",
        activity: state.activity ?? "idle",
        agents: state.agents ?? {},
        goals: state.goals ?? {},
        calls: state.calls ?? [],
        tools: body.tools ?? [],
        artifact: state.artifact ?? null,
        elementStrings: body.elementStrings ?? {},
        prompt: body.prompt ?? "",
      });
    } catch (err) {
      setEngineError(err.message);
    }
  }, [engineSignal]);
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

  useEffect(() => {
    loadEngine();
  }, [loadEngine]);

  // Live-event bus feeds the engine signal's activity, so the
  // status indicator moves during a chat turn without a refetch.
  // The bus carries no server state: it only flips the activity
  // word on the snapshot this section already holds.
  // Milestone 2: goal:/agent: events are NOT dropped anymore
  // (the bus now accepts them — see src/lib/live-events.js).
  // Canonical reactivity for the live-agent section is still
  // the state-based engine signal itself; a goal:/agent: event
  // triggers a route refetch into that signal (loadEngine),
  // which is a refetch-on-event, never a server push.
  useEffect(() => {
    const offs = [
      subscribeLiveEvent("llm:start", () =>
        engineSignal.set((prev) =>
          prev ? { ...prev, activity: "llm" } : prev,
        ),
      ),
      subscribeLiveEvent("llm:end", () =>
        engineSignal.set((prev) =>
          prev ? { ...prev, activity: "idle" } : prev,
        ),
      ),
      subscribeLiveEvent("llm:error", () =>
        engineSignal.set((prev) =>
          prev ? { ...prev, activity: "error" } : prev,
        ),
      ),
      subscribeLiveEvent("goal:phase", () => loadEngine()),
      subscribeLiveEvent("agent:spawn", () => loadEngine()),
      subscribeLiveEvent("agent:report", () => loadEngine()),
    ];
    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [engineSignal, loadEngine]);

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
      // Harness entry (Milestone 2): the request goes to the
      // harness, which creates one goal and passes it to the
      // developer; the reply shown is the developer's report.
      // The single-turn /api/chat route was deleted in Milestone 4; it is not used here.
      const response = await fetch("/api/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: text }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "harness request failed");
      }
      setMessages([
        ...nextMessages,
        { id: crypto.randomUUID(), role: "assistant", content: body.report },
      ]);
      emitLiveEvent("llm:end", {
        detail: "Model call finished — reply received.",
      });
      emitLiveEvent("agent:report", {
        detail: "Developer reported back.",
      });
      // The harness run changed the engine object's goal/agents
      // state: refresh the engine signal from /api/engine-object
      // so card, canvas, and status show exactly the new state.
      await loadEngine();
    } catch (err) {
      setError(err.message);
      emitLiveEvent("llm:error", {
        reason: err.message,
        detail: `Harness run failed: ${err.message}`,
      });
    } finally {
      setLoading(false);
      // Deliberately no loadSnapshot() here: the legacy panels
      // keep their fetch-once state; the live-agent section is
      // refreshed via loadEngine() above, not via the old path.
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
            ASKK
          </span>
          <span className="flex gap-4">
            <a
              href="/models"
              className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Models
            </a>
            <a
              href="/replay"
              className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Replay
            </a>
            <a
              href="/showcase"
              className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Components showcase
            </a>
          </span>
        </div>

        {liveLoading && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connecting…
          </p>
        )}
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {/* LEGACY PATH (marked, not silently divergent): the
          CombinedView panels below still fetch
          /api/engine|tools|artifact|agent|soul once into React
          state (snapshot-then-events), and the old single-turn
          /api/chat route was deleted in Milestone 4. Neither is the harness
          path: send() above posts to /api/harness, and the
          live-agent section below it is the engine-twin path:
          it subscribes to the engine signal, not to a second
          fetched copy. */}
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

        {/* Live agent section (engine-twin path): card, canvas,
          and status all render from the SAME engine signal
          snapshot — the server's single engine object, via
          /api/engine-object — not from a second fetched copy.
          No new fetch, no hardcoded panels. If the engine does
          not load, this section says so instead of rendering a
          divergent copy from the legacy chat data above. */}
        {engineError && (
          <p className="text-sm text-red-600">
            Engine live section unavailable: {engineError}
          </p>
        )}
        {engineSnapshot && (
          <div className="flex flex-col gap-6">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Live agent — card, canvas, and status from one engine signal.
            </p>
            <LiveStatus signal={engineSignal} />
            <AgentCard snapshot={engineSnapshot} />
            <LiveCanvas snapshot={engineSnapshot} />
          </div>
        )}
      </main>
    </div>
  );
}
