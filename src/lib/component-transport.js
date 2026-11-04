// Component transport — signal -> DOM across HTTP.
//
// The transport that feeds a component's signal. Components
// themselves NEVER fetch: they subscribe to a signal
// (useLiveState) and re-render when it changes. This module is
// the only place that delivers new trees to that signal.
//
// NAMED TRANSPORT: SSE first, polling fallback.
//   - SSE: GET /api/engine-stream sends `event: engine` with the
//     engine object's current snapshot + agentRender tree, on
//     connect and every 2s. When EventSource is available, the
//     transport opens it and delivers each new tree to onTree.
//   - Polling fallback: when EventSource is unavailable, or the
//     stream errors, the transport polls fetchTree() on
//     intervalMs and delivers only when the tree JSON actually
//     changed — so a poll that finds nothing new does NOT
//     re-render the DOM. Polling is the fallback, not the
//     design: the SSE route is the named replacement, and it is
//     already implemented (src/app/api/engine-stream/route.js),
//     not a future promise. If SSE proves flaky in a browser,
//     the fallback keeps the UI live and the failure is visible
//     (onError / fallback flag), never silently claimed as push.
"use client";

export function createComponentTransport({
  onTree,
  fetchTree = null,
  streamUrl = "/api/engine-stream",
  intervalMs = 2000,
} = {}) {
  if (typeof onTree !== "function") {
    throw new Error("component transport needs an onTree callback");
  }
  let lastJson = null;
  let source = null;
  let timer = null;
  let stopped = false;
  let usingFallback = false;

  const deliver = (tree) => {
    if (tree === null || tree === undefined || stopped) {
      return;
    }
    const json = JSON.stringify(tree);
    if (json === lastJson) {
      return;
    }
    lastJson = json;
    onTree(tree);
  };

  const startPolling = () => {
    if (timer !== null || typeof fetchTree !== "function") {
      return;
    }
    usingFallback = true;
    timer = setInterval(async () => {
      if (stopped) {
        return;
      }
      try {
        deliver(await fetchTree());
      } catch {
        // Poll errors are silent: the next poll retries, and
        // the UI keeps its last good tree.
      }
    }, intervalMs);
  };

  const start = () => {
    stopped = false;
    if (typeof EventSource !== "undefined" && streamUrl) {
      try {
        source = new EventSource(streamUrl);
        source.addEventListener("engine", (event) => {
          try {
            const body = JSON.parse(event.data);
            deliver(body.agentRender ?? null);
          } catch {
            // A malformed SSE frame is ignored; the next frame
            // (or the polling fallback) replaces it.
          }
        });
        source.onerror = () => {
          // SSE failed: close it and fall back to polling,
          // never leave the UI frozen on a dead stream.
          try {
            source.close();
          } catch {
            // Already closed.
          }
          source = null;
          startPolling();
        };
        return { stop: () => stop() };
      } catch {
        source = null;
      }
    }
    startPolling();
    return { stop: () => stop() };
  };

  const stop = () => {
    stopped = true;
    if (source) {
      try {
        source.close();
      } catch {
        // Already closed.
      }
      source = null;
    }
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    start,
    stop,
    get usingFallback() {
      return usingFallback;
    },
  };
}
