// Engine stream — the named push transport across HTTP.
//
// SSE: GET /api/engine-stream sends `event: engine` with the
// engine object's current snapshot + agentRender tree, on
// connect and every 2s, until the client disconnects. This is
// server push: the server sends, the client does not poll for
// these frames. The client transport
// (src/lib/component-transport.js) prefers this stream and
// falls back to polling only when EventSource is unavailable
// or the stream errors.
//
// No keys, no absolute paths: the payload is the same shape
// as /api/engine-object (state, agentRender), with the same
// agentRenderError handling. If the tree cannot be built, the
// frame still carries the state and reports the error plainly.
import { renderAgentForScreen } from "@/core/agent-render.js";
import { getEngineObject } from "@/core/engine-object.js";

// Note: no `export const dynamic` here — it is incompatible
// with this project's `cacheComponents: true` (build error),
// and a route returning a ReadableStream is dynamic by nature.

function frame() {
  const engine = getEngineObject("personal");
  let agentRender = null;
  let agentRenderError = null;
  try {
    agentRender = renderAgentForScreen(engine);
  } catch (err) {
    agentRenderError = err.message;
  }
  return {
    state: engine.snapshot(),
    agentRender,
    ...(agentRenderError ? { agentRenderError } : {}),
  };
}

export async function GET(request) {
  const encoder = new TextEncoder();
  let interval = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          const data = JSON.stringify(frame());
          controller.enqueue(
            encoder.encode(`event: engine\ndata: ${data}\n\n`),
          );
        } catch {
          // A failed frame never kills the stream; the next
          // tick retries with the engine's current state.
        }
      };
      send();
      interval = setInterval(send, 2000);
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      if (interval !== null) {
        clearInterval(interval);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
