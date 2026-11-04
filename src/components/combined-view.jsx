// Combined view — the picked view-6 prototype, ported into askk's
// React/Next style (shadcn collapsibles, Amarante site-wide), not
// copied HTML.
//
// Layout, exactly as picked:
//   - Dashboard overview at the top: overview stats (runs, LLM
//     calls, tool calls, errors), Recent runs (one line each, last
//     status + "N of 5 run tasks done"), Desk overview (model, core
//     tools count, live artifacts open count, Skills placeholder).
//   - Companion card below it, prominent: round SVG face changing
//     with state, plain-language status line, 4-up live stats,
//     live run feed in miniature, Show detail toggle.
//   - Orb glow on the card OUTLINE (border + box-shadow, see
//     src/app/globals.css .combined-card): idle grey dim slow/none,
//     LLM sky pulsing 1.1s, tool violet fast 0.7s, waiting amber
//     slow-breathing 2.2s, error red rapid flicker 0.45s,
//     running/success emerald pulsing 1.4s. The glow state is
//     exposed as data-glow on the card, so it is assertable.
//     Motion only while running; prefers-reduced-motion stops it.
//   - Click expand (card face, card header, or Expand button —
//     all three, keyboard-accessible: card focusable, Enter/Space
//     toggles, aria-expanded updates) expands IN PLACE to the
//     minimal dot detailed view: dot + "ASKK · default desk",
//     dense calm stats, two-column layout, and the FULL
//     render-template sections in detail — Soul, Agent, History,
//     Tools, Live Artifacts, Skills. Same live object expanded,
//     not a second copy: the feed list is rendered in exactly one
//     place (card when compact, expanded view when expanded),
//     and feed/stats/state are shared state, so expand/collapse
//     preserves them exactly (no reset, no replay).
//   - Chat stays working: this component contains the chat
//     (messages, input, Send, no-model state) — it wraps the chat,
//     it does not replace it. The chat is still single-turn
//     (one query, one reply, no loop); tools are loaded/listed
//     only, never invoked by the chat.
//
// Live updates: the page takes an initial snapshot on load
// (/api/engine, /api/tools, /api/artifact, /api/agent, /api/soul)
// and passes it in as props. After that, this view updates on
// the client live-event bus (src/lib/live-events.js): the chat
// flow emits llm:start / llm:end / llm:error and the view
// subscribes — face, glow, status, stats and feed update
// immediately on the event, with no refetch after a reply.
// No server SSE stream is claimed here; that is a later step.
//
// Verification: the "Run verification" control (labelled as a
// test control) simulates the agent life cycle through the SAME
// bus and the SAME state the real chat uses, and asserts actual
// DOM/UI state after each step (face, glow, status, stats, feed
// rows, expanded/collapsed, artifact open list). Results render
// in a visible panel, PASS/FAIL per step, failures left visible.
// Verification feed/artifact entries are simulated — their
// details say "(verification)" — they are not real disk state.
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { emitLiveEvent, subscribeAllLiveEvents } from "@/lib/live-events.js";

const PHASE_STATE = {
  idle: {
    face: "idle",
    glow: "grey",
    color: "#9ca3af",
    status: "Idle — ready when you are.",
    glyph: "○",
  },
  llm: {
    face: "llm",
    glow: "sky",
    color: "#0ea5e9",
    status: "Calling LLM…",
    glyph: "◐",
  },
  tool: {
    face: "tool",
    glow: "violet",
    color: "#8b5cf6",
    status: "Calling tool…",
    glyph: "◆",
  },
  waiting: {
    face: "waiting",
    glow: "amber",
    color: "#f59e0b",
    status: "Waiting for a reply…",
    glyph: "◌",
  },
  error: {
    face: "error",
    glow: "red",
    color: "#ef4444",
    status: "Error — run failed, recovering…",
    glyph: "✕",
  },
  success: {
    face: "success",
    glow: "emerald",
    color: "#10b981",
    status: "Success — run complete.",
    glyph: "✓",
  },
};

const FACES = {
  idle: {
    mouth: "M38 66 Q50 76 62 66",
    eye: "6,7",
    browL: "M27 30 Q35 26 43 30",
    browR: "M57 30 Q65 26 73 30",
  },
  llm: {
    mouth: "M44 66 Q50 62 56 66",
    eye: "5,8",
    browL: "M27 28 Q35 25 43 29",
    browR: "M57 28 Q65 25 73 29",
  },
  tool: {
    mouth: "M40 67 Q50 72 60 67",
    eye: "6,4",
    browL: "M27 32 Q35 29 43 32",
    browR: "M57 32 Q65 29 73 32",
  },
  waiting: {
    mouth: "M40 68 Q45 65 50 68 Q55 65 60 68",
    eye: "6,3",
    browL: "M27 31 Q35 28 43 31",
    browR: "M57 31 Q65 28 73 31",
  },
  error: {
    mouth: "M40 72 Q50 62 60 72",
    eye: "5,7",
    browL: "M27 33 Q35 29 43 28",
    browR: "M57 28 Q65 29 73 33",
  },
  success: {
    mouth: "M34 64 Q50 82 66 64",
    eye: "7,3",
    browL: "M27 30 Q35 26 43 30",
    browR: "M57 30 Q65 26 73 30",
  },
};

function Face({ phase }) {
  const face = FACES[phase] ?? FACES.idle;
  const [rx, ry] = face.eye.split(",");
  return (
    <svg viewBox="0 0 100 100" aria-hidden data-testid="companion-face-svg">
      <title>Companion avatar face</title>
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="#fff7ed"
        stroke="#fcd34d"
        strokeWidth="2"
      />
      <circle cx="24" cy="60" r="7" fill="#fda4af" opacity=".55" />
      <circle cx="76" cy="60" r="7" fill="#fda4af" opacity=".55" />
      <ellipse data-face-eye-l cx="35" cy="42" rx={rx} ry={ry} fill="#1f2937" />
      <ellipse data-face-eye-r cx="65" cy="42" rx={rx} ry={ry} fill="#1f2937" />
      <path
        d={face.browL}
        fill="none"
        stroke="#1f2937"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d={face.browR}
        fill="none"
        stroke="#1f2937"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d={face.mouth}
        fill="none"
        stroke="#1f2937"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FeedList({ feed, artifactVersion, onMockRetry }) {
  if (feed.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No run events yet — send a chat message, or run verification.
      </p>
    );
  }
  return (
    <ul data-testid="live-feed" className="flex flex-col gap-2">
      {feed.map((row) => {
        const later = artifactVersion - row.versionAtCreate;
        const honesty =
          later === 0
            ? "after this call"
            : `now — ${later} later call${later === 1 ? "" : "s"} changed it since`;
        return (
          <li
            key={row.id}
            id={row.id}
            data-error={row.isError ? "true" : "false"}
            className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
          >
            <span
              aria-hidden
              className="mt-1.5 size-2.5 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
            <details className="w-full">
              <summary className="cursor-pointer">
                <b>
                  {row.glyph} {row.title}
                </b>
                <small className="block text-zinc-500">{row.detail}</small>
              </summary>
              <div className="mt-2 flex flex-col gap-1 border border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
                <div>
                  <b className="text-zinc-900 dark:text-zinc-50">Inputs: </b>
                  {row.detail}
                </div>
                <div>
                  <b className="text-zinc-900 dark:text-zinc-50">Result: </b>
                  {row.result}
                </div>
                <div>
                  <b className="text-zinc-900 dark:text-zinc-50">
                    Artifact state:{" "}
                  </b>
                  {row.artifactState} —{" "}
                  <span className="honesty">{honesty}</span>
                </div>
                {row.isError && (
                  <button
                    type="button"
                    className="mt-1 w-fit rounded-full border border-zinc-200 px-3 py-1 text-xs dark:border-zinc-800"
                    onClick={() => onMockRetry(row)}
                  >
                    Retry this step only (mock)
                  </button>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export default function CombinedView({
  live,
  soul,
  agent,
  toolsData,
  artifactData,
  messages,
  input,
  setInput,
  onSend,
  loading,
  error,
  liveLoading,
}) {
  const [phase, setPhase] = useState("idle");
  const [feed, setFeed] = useState([]);
  const [counts, setCounts] = useState({
    llm: 0,
    tool: 0,
    ok: 0,
    err: 0,
    runs: 0,
  });
  const [tasks, setTasks] = useState({
    plan: false,
    open: false,
    expand: false,
    recovery: false,
    success: false,
  });
  const [artifactVersion, setArtifactVersion] = useState(0);
  const [liveOpen, setLiveOpen] = useState(null);
  const [liveFocus, setLiveFocus] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const seqRef = useRef(0);
  const versionRef = useRef(0);
  const hadErrorRef = useRef(false);
  const openRef = useRef([]);
  const focusRef = useRef(null);

  const openFiles = liveOpen ?? artifactData?.artifact?.open ?? [];
  const focus = liveFocus ?? artifactData?.artifact?.focus?.path ?? null;
  const modified = artifactData?.artifact?.modified ?? [];
  const agentHistory = artifactData?.history ?? [];
  const toolsList = toolsData?.tools ?? agent?.tools?.list ?? [];
  const progress = Object.values(tasks).filter(Boolean).length;

  function addFeedRow({
    color,
    glyph,
    title,
    detail,
    result,
    isError = false,
  }) {
    const id = `engine-call-combined-${++seqRef.current}`;
    setFeed((prev) => [
      ...prev,
      {
        id,
        color,
        glyph,
        title,
        detail,
        result,
        isError,
        versionAtCreate: versionRef.current,
        artifactState: `open: ${openRef.current.join(", ") || "none"} · focus: ${focusRef.current ?? "none"}`,
      },
    ]);
    return id;
  }

  function handleBusEvent(type, detail) {
    switch (type) {
      case "llm:start":
        setPhase("llm");
        setCounts((prev) => ({
          ...prev,
          llm: prev.llm + 1,
          runs: prev.runs + 1,
        }));
        if (hadErrorRef.current) {
          setTasks((prev) => ({ ...prev, recovery: true }));
        }
        addFeedRow({
          color: "#0ea5e9",
          glyph: "◐",
          title: "LLM started",
          detail: detail?.detail ?? "Model call — drafting the next step…",
          result: "In flight.",
        });
        break;
      case "llm:end":
        setPhase("idle");
        setCounts((prev) => ({ ...prev, ok: prev.ok + 1 }));
        setTasks((prev) => ({ ...prev, plan: true }));
        addFeedRow({
          color: "#0ea5e9",
          glyph: "◐",
          title: "LLM ended",
          detail: detail?.detail ?? "Model call finished — reply received.",
          result: "Recorded in this row.",
        });
        break;
      case "llm:error":
        hadErrorRef.current = true;
        setPhase("error");
        setCounts((prev) => ({ ...prev, err: prev.err + 1 }));
        addFeedRow({
          color: "#ef4444",
          glyph: "✕",
          title: "Error",
          detail: detail?.reason ?? detail?.detail ?? "LLM call failed.",
          result: `Failed — plain-language reason: ${detail?.reason ?? detail?.detail ?? "LLM call failed."}`,
          isError: true,
        });
        break;
      case "artifact:open": {
        const path = detail?.path ?? "unknown";
        versionRef.current += 1;
        setArtifactVersion(versionRef.current);
        setPhase("tool");
        setCounts((prev) => ({ ...prev, tool: prev.tool + 1 }));
        setTasks((prev) => ({ ...prev, plan: true, open: true }));
        if (!openRef.current.includes(path)) {
          openRef.current = [...openRef.current, path];
        }
        focusRef.current = path;
        setLiveOpen(openRef.current);
        setLiveFocus(path);
        addFeedRow({
          color: "#8b5cf6",
          glyph: "◆",
          title: "Tool call: files.open",
          detail: detail?.detail ?? `Opening ${path}.`,
          result: "files.open completed · success.",
        });
        break;
      }
      case "artifact:expand":
        versionRef.current += 1;
        setArtifactVersion(versionRef.current);
        setPhase("tool");
        setTasks((prev) => ({ ...prev, expand: true }));
        addFeedRow({
          color: "#8b5cf6",
          glyph: "◆",
          title: "Artifact expanded",
          detail:
            detail?.detail ??
            "Live artifact expanded — open files re-read, previews updated.",
          result: "Recorded in this row.",
        });
        break;
      case "run:success":
        setPhase("success");
        setCounts((prev) => ({ ...prev, ok: prev.ok + 1 }));
        setTasks((prev) => ({ ...prev, success: true }));
        addFeedRow({
          color: "#10b981",
          glyph: "✓",
          title: "Success",
          detail: detail?.detail ?? "Run complete.",
          result: "Recorded in this row.",
        });
        break;
      case "run:error":
        hadErrorRef.current = true;
        setPhase("error");
        setCounts((prev) => ({ ...prev, err: prev.err + 1 }));
        addFeedRow({
          color: "#ef4444",
          glyph: "✕",
          title: "Error",
          detail: detail?.reason ?? detail?.detail ?? "Run failed.",
          result: `Failed — plain-language reason: ${detail?.reason ?? detail?.detail ?? "Run failed."} The step stays here, marked, with retry below.`,
          isError: true,
        });
        break;
      case "run:waiting":
        setPhase("waiting");
        addFeedRow({
          color: "#f59e0b",
          glyph: "◌",
          title: "Waiting / recovery",
          detail: detail?.detail ?? "Waiting for a reply…",
          result: "Recorded in this row.",
        });
        break;
      case "run:idle":
        setPhase("idle");
        break;
      default:
        break;
    }
  }

  // Subscribe once on mount by design — the handler updates
  // state through functional setters and refs, so re-subscribing
  // per render would duplicate feed rows. The ref always points
  // at the latest handler, so the subscription never goes stale.
  const handlerRef = useRef(handleBusEvent);
  handlerRef.current = handleBusEvent;
  useEffect(
    () =>
      subscribeAllLiveEvents((type, detail) =>
        handlerRef.current(type, detail),
      ),
    [],
  );

  // Keep the feed-row refs in step with the snapshot: until a
  // live artifact event arrives, the snapshot's open/focus are
  // the live state (liveOpen starts null for exactly this).
  useEffect(() => {
    if (liveOpen === null && artifactData?.artifact) {
      openRef.current = artifactData.artifact.open ?? [];
      focusRef.current = artifactData.artifact.focus?.path ?? null;
    }
  }, [artifactData, liveOpen]);

  function mockRetry(row) {
    addFeedRow({
      color: "#8b5cf6",
      glyph: "◆",
      title: "Mock retry",
      detail: `Retried step ${row.title} (mock, no real API call).`,
      result: "Mock retry recorded.",
    });
    setPhase("success");
  }

  const state = PHASE_STATE[phase] ?? PHASE_STATE.idle;
  const model = live?.defaultInference?.model ?? live?.engine?.model ?? "—";
  const provider = live?.defaultInference?.provider ?? "—";
  const endpoint = live?.defaultInference?.endpoint ?? "—";
  const hasDefault = Boolean(live?.hasDefault);
  const feedElement = (
    <FeedList
      feed={feed}
      artifactVersion={artifactVersion}
      onMockRetry={mockRetry}
    />
  );

  async function runVerification() {
    setVerifying(true);
    setVerification(null);
    // Reset to a clean state, then drive the life cycle through
    // the same bus the real chat uses.
    seqRef.current = 0;
    versionRef.current = 0;
    hadErrorRef.current = false;
    setFeed([]);
    setCounts({ llm: 0, tool: 0, ok: 0, err: 0, runs: 0 });
    setTasks({
      plan: false,
      open: false,
      expand: false,
      recovery: false,
      success: false,
    });
    setArtifactVersion(0);
    openRef.current = [];
    focusRef.current = null;
    setLiveOpen([]);
    setLiveFocus(null);
    setExpanded(false);
    setPhase("idle");
    const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
    await tick();
    const results = [];
    const check = (step, name, ok, detail) => {
      results.push({ step, name, ok: Boolean(ok), detail: detail ?? "" });
      console.log(
        `[verify] ${step} — ${name}: ${ok ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`,
      );
    };
    const el = (testid) => document.querySelector(`[data-testid="${testid}"]`);
    const text = (testid) => el(testid)?.textContent ?? "";
    const feedText = () => el("live-feed")?.textContent ?? "";

    emitLiveEvent("run:idle", {});
    await tick();
    check(
      "1 idle",
      "face calm grey + glow dim grey + status Idle",
      el("companion-face")?.getAttribute("data-face") === "idle" &&
        el("companion-card")?.getAttribute("data-glow") === "grey" &&
        text("status-line").startsWith("Idle"),
      `face=${el("companion-face")?.getAttribute("data-face")}, glow=${el("companion-card")?.getAttribute("data-glow")}`,
    );
    check(
      "1 idle",
      "stats all 0",
      text("stat-llm") === "0" &&
        text("stat-tool") === "0" &&
        text("stat-ok") === "0" &&
        text("stat-err") === "0",
      `llm=${text("stat-llm")}, tool=${text("stat-tool")}`,
    );
    check(
      "1 idle",
      "dot view collapsed, card aria-expanded=false",
      el("companion-card")?.getAttribute("aria-expanded") === "false" &&
        !document.querySelector('[data-testid="expanded-view"]'),
      `aria-expanded=${el("companion-card")?.getAttribute("aria-expanded")}`,
    );

    emitLiveEvent("llm:start", {
      detail: "Model call 1 — drafting the next step… (verification)",
    });
    await tick();
    check(
      "2 LLM start",
      "face blue thinking + glow sky pulsing + status Calling LLM…",
      el("companion-face")?.getAttribute("data-face") === "llm" &&
        el("companion-card")?.getAttribute("data-glow") === "sky" &&
        text("status-line") === "Calling LLM…",
      `status=${text("status-line")}`,
    );
    check(
      "2 LLM start",
      "feed row running with stable id",
      Boolean(
        el("live-feed")?.querySelector("li[id^='engine-call-combined-']"),
      ) && feedText().includes("LLM started"),
      "first feed row id prefix engine-call-combined-",
    );

    emitLiveEvent("artifact:open", {
      path: "src/core/tool.js",
      detail: "Opening src/core/tool.js — verification.",
    });
    await tick();
    check(
      "3 files.open",
      "face violet focused + glow violet fast + feed row files.open",
      el("companion-face")?.getAttribute("data-face") === "tool" &&
        el("companion-card")?.getAttribute("data-glow") === "violet" &&
        feedText().includes("files.open"),
      "state=tool, glow=violet",
    );
    check(
      "3 files.open",
      "live artifact open list updated",
      (text("artifact-open") || text("card-artifact-open")).includes(
        "src/core/tool.js",
      ) &&
        (text("artifact-focus") || text("card-artifact-focus")).includes(
          "src/core/tool.js",
        ),
      `open=${text("card-artifact-open") || text("artifact-open")}`,
    );

    setExpanded(true);
    emitLiveEvent("artifact:expand", {
      detail: "Live artifact expanded — verification.",
    });
    await tick();
    check(
      "4 artifact expand",
      "expanded dot view shows open file + focus + modified element",
      Boolean(el("expanded-view")) &&
        text("artifact-open").includes("src/core/tool.js") &&
        text("artifact-focus").includes("src/core/tool.js") &&
        Boolean(el("artifact-modified")),
      `expanded=${Boolean(el("expanded-view"))}`,
    );
    check(
      "4 artifact expand",
      "honesty label correct (after this call, no later call yet in this row)",
      (() => {
        const rows = el("live-feed")?.querySelectorAll(".honesty") ?? [];
        const last = rows[rows.length - 1];
        return last?.textContent === "after this call";
      })(),
      "honesty checked on last row",
    );

    emitLiveEvent("run:error", {
      reason:
        "build check exited non-zero (missing trailing newline in model.json, mock)",
      detail:
        "terminal.run build failed: build check exited non-zero (missing trailing newline in model.json, mock) (verification)",
    });
    await tick();
    const progress5 = Number.parseInt(
      (text("progress-done").match(/\d+/) ?? ["0"])[0],
      10,
    );
    check(
      "5 error",
      "face red worried + glow red flicker + error row visible with plain reason + mock retry",
      el("companion-face")?.getAttribute("data-face") === "error" &&
        el("companion-card")?.getAttribute("data-glow") === "red" &&
        feedText().includes("build check exited non-zero") &&
        Boolean(el("live-feed")?.querySelector("button")),
      "error row + retry button present",
    );
    check(
      "5 error",
      "stats error count increments and progress does NOT jump to done",
      Number.parseInt(text("stat-err"), 10) >= 1 && progress5 < 5,
      `err=${text("stat-err")}, progress=${progress5} of 5`,
    );

    emitLiveEvent("run:waiting", { detail: "Retrying once — verification." });
    await tick();
    check(
      "6 recovery waiting",
      "waiting amber slow-breathing (glow amber, status Waiting)",
      el("companion-face")?.getAttribute("data-face") === "waiting" &&
        el("companion-card")?.getAttribute("data-glow") === "amber" &&
        text("status-line").startsWith("Waiting"),
      `status=${text("status-line")}`,
    );
    emitLiveEvent("llm:start", {
      detail: "Model call recovered — verification.",
    });
    await tick();
    check(
      "6 recovery LLM",
      "error row stays visible marked, not erased",
      feedText().includes("build check exited non-zero") &&
        feedText().includes("Error"),
      "error row still in feed",
    );

    emitLiveEvent("run:success", { detail: "Run complete — verification." });
    await tick();
    const progress7 = Number.parseInt(
      (text("progress-done").match(/\d+/) ?? ["0"])[0],
      10,
    );
    check(
      "7 success",
      "face emerald happy + glow emerald pulse + success row + 5 of 5 done + success stat increments",
      el("companion-face")?.getAttribute("data-face") === "success" &&
        el("companion-card")?.getAttribute("data-glow") === "emerald" &&
        feedText().includes("Success") &&
        progress7 === 5 &&
        Number.parseInt(text("stat-ok"), 10) >= 1,
      `progress=${progress7}, ok=${text("stat-ok")}`,
    );

    const feedCountBefore = el("live-feed")?.querySelectorAll("li").length ?? 0;
    const statBefore = text("stat-llm");
    emitLiveEvent("run:idle", {});
    setExpanded(false);
    await tick();
    check(
      "8 idle again",
      "face calm grey + glow dim + status Idle",
      el("companion-face")?.getAttribute("data-face") === "idle" &&
        el("companion-card")?.getAttribute("data-glow") === "grey" &&
        text("status-line").startsWith("Idle"),
      `status=${text("status-line")}`,
    );
    check(
      "8 idle again",
      "collapse back to compact card with feed/stats preserved (no reset)",
      el("companion-card")?.getAttribute("aria-expanded") === "false" &&
        (el("live-feed")?.querySelectorAll("li").length ?? 0) ===
          feedCountBefore &&
        text("stat-llm") === statBefore,
      `feed rows before=${feedCountBefore}, after=${el("live-feed")?.querySelectorAll("li").length}`,
    );

    const failed = results.filter((row) => !row.ok).length;
    setVerification({
      overall: failed === 0 ? "PASS" : "FAIL",
      results,
    });
    setVerifying(false);
  }

  function toggleExpanded() {
    setExpanded((prev) => !prev);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Dashboard overview */}
      <section aria-label="Dashboard overview" className="flex flex-col gap-3">
        <h1 className="text-2xl">ASKK · Combined Dashboard</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Dashboard is the overview. The companion card sits here, face with
          live run status, outline glowing with the orb&apos;s state colour.
          Click the card to expand to the clean, descriptive dot view — same
          live object, not a second copy.
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b className="block text-xl">{counts.runs}</b>
            <span className="text-xs text-zinc-500">Runs</span>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b className="block text-xl text-sky-600" data-testid="dash-llm">
              {counts.llm}
            </b>
            <span className="text-xs text-zinc-500">LLM calls</span>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b
              className="block text-xl text-violet-600"
              data-testid="dash-tool"
            >
              {counts.tool}
            </b>
            <span className="text-xs text-zinc-500">Tool calls</span>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b className="block text-xl text-red-600" data-testid="dash-err">
              {counts.err}
            </b>
            <span className="text-xs text-zinc-500">Errors</span>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold">
              Recent runs — one line each
            </h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {counts.runs === 0 ? (
                <li>No runs yet — send a chat message to start one.</li>
              ) : (
                <li>
                  current run — {state.status} · {progress} of 5 run tasks done
                </li>
              )}
            </ul>
            <p className="mt-2 text-sm text-zinc-500">
              Last run status: {state.status} · Progress:{" "}
              {counts.runs === 0
                ? "0 of 5 run tasks done"
                : `${progress} of 5 run tasks done`}
            </p>
          </section>
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold">Desk overview</h2>
            <p className="mt-2 text-sm">
              Model: {model} · Tools: <b>{toolsList.length} core tools</b> ·
              Live artifacts: {openFiles.length} open · Skills:{" "}
              <i>Skills will be added later.</i>
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Glow legend — read the card outline before reading text: grey dim
              idle · sky pulsing LLM · violet fast tool · amber slow-breathing
              waiting · red rapid flicker error · emerald pulsing success.
            </p>
          </section>
        </div>
      </section>

      {/* Companion card — a focusable expandable region by design
          (prototype spec: face/header/Expand all expand, Enter/Space
          toggles, aria-expanded updates); its inner buttons
          stopPropagation so they are not double-activated. The
          a11y rules for this pattern are off for this file only
          in biome.json, as with breadcrumb.jsx. */}
      <section
        data-testid="companion-card"
        data-glow={state.glow}
        className="combined-card mx-auto w-full max-w-[460px] cursor-pointer overflow-hidden rounded-[28px] border-[3px] bg-white dark:bg-zinc-950"
        tabIndex="0"
        role="button"
        aria-expanded={expanded}
        aria-label="Companion card, click or press Enter or Space to expand to the dot view"
        onClick={toggleExpanded}
        onKeyDown={(event) => {
          if (
            (event.key === "Enter" || event.key === " ") &&
            event.target === event.currentTarget
          ) {
            event.preventDefault();
            toggleExpanded();
          }
        }}
      >
        <div
          data-testid="card-top"
          className="flex min-h-[230px] flex-col items-center px-5 py-5 text-center"
          onClick={(event) => {
            event.stopPropagation();
            toggleExpanded();
          }}
        >
          <div className="relative size-32">
            <div
              data-testid="companion-face"
              data-face={state.face}
              role="img"
              aria-label={`Companion avatar, ${state.face}`}
              className="flex size-32 items-center justify-center rounded-full border-4 border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="size-24">
                <Face phase={phase} />
              </div>
            </div>
            <span
              aria-hidden
              className="absolute right-1.5 bottom-2.5 size-5 rounded-full border-[3px] border-white dark:border-zinc-950"
              style={{ background: state.color }}
            />
          </div>
          <h2 className="mt-2 text-2xl">ASKK</h2>
          <div
            data-testid="status-line"
            className="text-base"
            aria-live="polite"
          >
            {state.status}
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            Desk: default · Click card to expand ↓
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 border-y border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="rounded-xl border border-zinc-200 bg-white p-2 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b className="block text-sky-600" data-testid="stat-llm">
              {counts.llm}
            </b>
            <span className="text-xs text-zinc-500">LLM calls</span>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-2 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b className="block text-violet-600" data-testid="stat-tool">
              {counts.tool}
            </b>
            <span className="text-xs text-zinc-500">Tool calls</span>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-2 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b className="block text-emerald-600" data-testid="stat-ok">
              {counts.ok}
            </b>
            <span className="text-xs text-zinc-500">Success</span>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-2 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <b className="block text-red-600" data-testid="stat-err">
              {counts.err}
            </b>
            <span className="text-xs text-zinc-500">Errors</span>
          </div>
        </div>

        {!expanded && (
          <div className="flex flex-col gap-3 px-4 py-3">
            <h3 className="text-sm font-semibold">Live run feed</h3>
            <div
              className="flex flex-wrap gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={runVerification}
                disabled={verifying}
              >
                {verifying ? "Verifying…" : "Run verification"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={expanded}
                onClick={toggleExpanded}
              >
                Expand to dot view ↓
              </Button>
              <span className="text-xs text-zinc-500">
                Run verification is a test control: it simulates the agent life
                cycle and checks this view&apos;s UI state per step. It calls no
                real model or tool.
              </span>
            </div>
            <p className="text-xs text-zinc-500" aria-live="polite">
              <span data-testid="progress-done">
                {progress} of 5 run tasks done
              </span>
            </p>
            <p className="text-xs text-zinc-500">
              Live artifact — open:{" "}
              <span data-testid="card-artifact-open">
                {openFiles.length === 0 ? "none" : openFiles.join(", ")}
              </span>
              {" · "}focus:{" "}
              <span data-testid="card-artifact-focus">{focus ?? "—"}</span>
            </p>
            {feedElement}
            <Collapsible open={showDetail} onOpenChange={setShowDetail}>
              <CollapsibleTrigger
                className="w-full rounded-xl bg-zinc-900 px-4 py-2 text-left text-sm text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                onClick={(event) => event.stopPropagation()}
              >
                {showDetail
                  ? "Hide detail ↑"
                  : "Show detail ↓ · Soul · Instructions · Agent · History · Tools · Artifacts · Memory · Skills (card detail)"}
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-2 px-1 py-3 text-sm">
                <section>
                  <h3 className="font-medium">Soul (preview)</h3>
                  <p className="text-zinc-500">
                    {soul?.instructions?.split(/\r?\n/)[0] ??
                      live?.engine?.instructionsPreview ??
                      "—"}
                  </p>
                </section>
                <section>
                  <h3 className="font-medium">Agent — live engine</h3>
                  <p className="text-zinc-500">
                    Model: {model} · Status:{" "}
                    {hasDefault ? "Ready" : "No model configured"} · Models in
                    store: {live?.inferenceCount ?? 0} · Session:{" "}
                    {messages.length}
                  </p>
                </section>
                <section>
                  <h3 className="font-medium">Tools</h3>
                  <p className="text-zinc-500">
                    {toolsList.length} core tools, 0 web tools. Full list in the
                    expanded dot view.
                  </p>
                </section>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </section>

      {/* Expanded minimal dot detailed view — same live object */}
      {expanded && (
        <section
          data-testid="expanded-view"
          aria-label="Expanded dot view"
          className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <header className="flex items-center gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <span
              aria-hidden
              className="size-3.5 shrink-0 rounded-full"
              style={{ background: state.color }}
            />
            <div>
              <h2 className="text-xl">
                ASKK{" "}
                <span className="text-sm text-zinc-500">
                  · default desk — expanded dot view
                </span>
              </h2>
              <p className="text-sm text-zinc-500">
                Clean and descriptive. Same live object, same feed, same stats —
                expanded, not a second copy.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => setExpanded(false)}
            >
              Collapse ↑
            </Button>
          </header>
          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className="rounded-xl border border-zinc-200 p-2 text-center dark:border-zinc-800">
              <b className="block text-sky-600">{counts.llm}</b>
              <span className="text-xs text-zinc-500">LLM calls</span>
            </div>
            <div className="rounded-xl border border-zinc-200 p-2 text-center dark:border-zinc-800">
              <b className="block text-violet-600">{counts.tool}</b>
              <span className="text-xs text-zinc-500">Tool calls</span>
            </div>
            <div className="rounded-xl border border-zinc-200 p-2 text-center dark:border-zinc-800">
              <b className="block text-emerald-600">{counts.ok}</b>
              <span className="text-xs text-zinc-500">Success</span>
            </div>
            <div className="rounded-xl border border-zinc-200 p-2 text-center dark:border-zinc-800">
              <b className="block text-red-600">{counts.err}</b>
              <span className="text-xs text-zinc-500">Errors</span>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1.15fr_.85fr]">
            <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="text-sm font-semibold">Live run feed</h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runVerification}
                  disabled={verifying}
                >
                  {verifying ? "Verifying…" : "Run verification"}
                </Button>
                <span className="text-xs text-zinc-500">
                  Test control — simulates the life cycle, checks this view per
                  step, calls no real model or tool.
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                <span data-testid="progress-done">
                  {progress} of 5 run tasks done
                </span>
              </p>
              {feedElement}
              <section>
                <h3 className="text-sm font-semibold">Agent — live engine</h3>
                <dl className="mt-1 flex flex-col gap-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">Status</dt>
                    <dd>{hasDefault ? "Ready" : "No model configured"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">Model</dt>
                    <dd>{model}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">Provider</dt>
                    <dd>{provider}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">Endpoint</dt>
                    <dd className="break-all">{endpoint}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">
                      Models in store
                    </dt>
                    <dd>{live?.inferenceCount ?? 0}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">Messages</dt>
                    <dd>{messages.length}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">
                      Agent (agent.md)
                    </dt>
                    <dd>
                      {agent?.name ?? "default"} · source:{" "}
                      {agent?.source ?? "—"} · tools:{" "}
                      {agent?.tools?.count ?? toolsList.length} · web: 0
                    </dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3 className="text-sm font-semibold">
                  History — labelled separately
                </h3>
                <h4 className="mt-2 font-medium">Session history</h4>
                {messages.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No session messages yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {messages.map((message, index) => (
                      <li key={`${message.role}-${index}`}>
                        <span className="text-xs text-zinc-500">
                          {message.role}
                        </span>
                        <span className="block whitespace-pre-wrap">
                          {message.content}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <h4 className="mt-2 font-medium">Agent history</h4>
                {agentHistory.length === 0 ? (
                  <p className="text-sm text-zinc-500">No agent history yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {agentHistory.map((entry, index) => (
                      <li key={`${entry.timestamp}-${entry.action}-${index}`}>
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
              </section>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <section>
                <h2 className="text-sm font-semibold">Soul</h2>
                <details open>
                  <summary className="cursor-pointer text-sm text-zinc-500">
                    Soul (soul.md) — who the agent is — click to collapse /
                    expand
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {soul?.soul ?? "—"}
                  </pre>
                  <p className="mt-1 text-xs text-zinc-500">
                    Source: {soul?.soulSource ?? "public"}. Separate from
                    Instructions below; no keys or absolute paths shown.
                  </p>
                </details>
              </section>
              <section>
                <h2 className="text-sm font-semibold">Instructions</h2>
                <details open>
                  <summary className="cursor-pointer text-sm text-zinc-500">
                    Instructions (instructions.md) — how it answers — click to
                    collapse / expand
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {soul?.instructions ??
                      live?.engine?.instructionsPreview ??
                      "—"}
                  </pre>
                  <p className="mt-1 text-xs text-zinc-500">
                    Source:{" "}
                    {soul?.instructionsSource ?? soul?.source ?? "public"}.
                    Shown as its own item, not folded into Soul.
                  </p>
                </details>
              </section>
              <section>
                <h3 className="text-sm font-semibold">
                  Tools — core only, no web tools
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {toolsList.map((tool) => (
                    <span
                      key={tool.name}
                      className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-800"
                    >
                      {tool.name}{" "}
                      <i className="text-zinc-500">· {tool.expectation}</i>
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Badges: immediate · done · stream · live-state. Web tools:
                  none — 0 web tools shipped.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Agent (agent.md) tools:{" "}
                  {agent?.tools?.count ?? toolsList.length} · files:{" "}
                  {agent?.tools?.list?.filter((tool) =>
                    tool.name.startsWith("files."),
                  ).length ?? "—"}{" "}
                  · terminal:{" "}
                  {agent?.tools?.list?.filter((tool) =>
                    tool.name.startsWith("terminal."),
                  ).length ?? "—"}
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold">Live Artifacts</h3>
                <p className="text-sm">
                  <b>Artifact:</b> {artifactData?.artifact?.id ?? "default"} ·{" "}
                  <b>Root:</b> project root
                </p>
                <p className="text-sm">
                  <b>Focus:</b>{" "}
                  <span data-testid="artifact-focus">{focus ?? "—"}</span>
                </p>
                <p className="text-sm">
                  <b>Open files:</b>
                </p>
                <ul
                  data-testid="artifact-open"
                  className="flex flex-col gap-1 text-sm"
                >
                  {openFiles.length === 0 ? (
                    <li>
                      <em>No files open yet.</em>
                    </li>
                  ) : (
                    openFiles.map((path) => <li key={path}>{path}</li>)
                  )}
                </ul>
                <p className="text-sm">
                  <b>Modified:</b>{" "}
                  <span data-testid="artifact-modified">
                    {modified.length === 0
                      ? "none"
                      : modified.map((entry) => entry.path ?? entry).join(", ")}
                  </span>
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold">Memory</h3>
                <p className="text-sm">
                  <b>Agent memory (persistent):</b> state + agent history,
                  labelled separately from session chat history above.
                </p>
                <p className="text-sm">
                  <b>State:</b> open: {openFiles.join(", ") || "none"} · focus:{" "}
                  {focus ?? "none"} · modified:{" "}
                  {modified.length === 0
                    ? "none"
                    : modified.map((entry) => entry.path ?? entry).join(", ")}
                </p>
                <p className="text-sm">
                  <b>Agent history entries:</b>{" "}
                  {agentHistory.length === 0
                    ? "none yet (public template history is header-only, no fake entries)"
                    : `${agentHistory.length} entr${agentHistory.length === 1 ? "y" : "ies"}`}
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  {agentHistory.map((entry, index) => (
                    <li key={`${entry.timestamp}-${entry.action}-${index}`}>
                      <span className="text-zinc-500">
                        {entry.timestamp ? `${entry.timestamp} · ` : ""}
                        {entry.action}
                        {entry.path ? ` · ${entry.path}` : ""}
                        {entry.detail ? ` — ${entry.detail}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-zinc-500">
                  Source: personal memory when present, else the public template
                  (empty state, no fake history). Writes go to personal only,
                  never to public/defaults/.
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold">Skills</h3>
                <p className="text-sm text-zinc-500">
                  Skills will be added later.
                </p>
              </section>
            </div>
          </div>
        </section>
      )}

      {/* Verification panel */}
      {verification && (
        <section
          data-testid="verification-panel"
          aria-live="polite"
          className="rounded-xl border-2 border-zinc-900 bg-white p-4 dark:border-zinc-50 dark:bg-zinc-950"
        >
          <h2 className="text-base font-semibold">
            Verification — agent life cycle in the UI
          </h2>
          <p className="text-sm text-zinc-500">
            Test control only. Each check asserted actual DOM/UI state after
            that step, not just that an event fired. Failures stay visible here
            and are not hidden.
          </p>
          <p data-testid="verification-overall" className="mt-2 text-sm">
            Overall:{" "}
            <span
              className={
                verification.overall === "PASS"
                  ? "text-emerald-700"
                  : "text-red-600"
              }
            >
              {verification.overall} —{" "}
              {verification.results.filter((row) => row.ok).length} of{" "}
              {verification.results.length} checks passed
            </span>
          </p>
          <ol className="mt-2 flex flex-col gap-1 text-sm">
            {verification.results.map((row, index) => (
              <li key={`${row.step}-${row.name}-${index}`}>
                <span
                  className={
                    row.ok ? "text-emerald-700" : "text-red-600 font-semibold"
                  }
                >
                  {row.ok ? "PASS" : "FAIL"}
                </span>
                {" — Step "}
                {row.step}: {row.name}
                {row.detail ? <small> ({row.detail})</small> : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Chat — contained by the combined view, not replaced by it */}
      <section className="flex flex-col gap-3">
        {!liveLoading && live && !hasDefault && (
          <p className="text-sm font-medium">
            No model configured — add an entry to personal/model.json
          </p>
        )}
        {messages.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Say something — the reply comes from the desk default model.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[85%] rounded-xl px-4 py-2 text-sm leading-6 whitespace-pre-wrap ${
              message.role === "user"
                ? "self-end bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "self-start border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            }`}
          >
            {message.content}
          </div>
        ))}
        {loading && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Thinking…</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Type a message"
          />
          <Button
            onClick={onSend}
            disabled={!input.trim() || loading || !hasDefault}
          >
            Send
          </Button>
        </div>
      </section>

      {/* Thin status strip, like the old status bar */}
      <div className="flex items-center gap-2 border-t border-zinc-200 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: state.color }}
        />
        <span aria-live="polite">{state.status}</span>
        <span className="ml-auto">
          {model}
          {counts.llm > 0 && ` · ${counts.llm} LLM calls`}
        </span>
      </div>
    </div>
  );
}
