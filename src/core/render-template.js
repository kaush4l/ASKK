// Render template data shaping — desk -> DeskTemplate props.
// The prompt render order itself lives in template-order.js
// (insertion order, default = old order); re-exported here so
// callers of this module get the ordered template from one place.
export {
  createTemplate,
  DEFAULT_TEMPLATE_ORDER,
  defaultTemplate,
} from "./template-order.js";

//
//   templateData(desk, messages)
//     -> { soul, agent, history, tools, liveArtifacts, skills, messages }
//
// This is what the rebase wiring step will call from page.js:
// page.js already fetches /api/engine, /api/tools, /api/artifact
// and holds the session messages; templateData turns those shapes
// (or a real desk object from createDesk) into exactly the props
// DeskTemplate expects. It never fetches, never writes, and never
// crashes on a missing section: a missing artifact, skill list, or
// history renders as an empty/placeholder value, never as a fake
// object. No keys, no absolute paths, and no .env content are
// carried through — only the plain data the API routes already
// return to the browser.
//
// Desk input shapes accepted (all optional, all guarded):
//   - a real desk from createDesk(): engine (with twin()),
//     defaultInference, inferences, listTools(), listArtifacts(),
//     liveArtifact, artifacts, and engine.metadata.source.
//   - a plain data object assembled from the API routes:
//     { engineTwin, defaultInference, hasDefault, inferenceCount,
//       tools: { list, files, terminal }, artifacts, agentHistory,
//       soul: { instructions, source } }.
// A desk passed as null/undefined yields the empty template.

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function plainToolSpec(tool) {
  if (!tool || typeof tool !== "object") {
    return null;
  }
  if (typeof tool.spec === "function") {
    try {
      return tool.spec();
    } catch {
      return null;
    }
  }
  return tool.name ? tool : null;
}

function engineTwinOf(desk) {
  const engine = desk?.engine ?? null;
  if (engine && typeof engine.twin === "function") {
    try {
      return engine.twin();
    } catch {
      return null;
    }
  }
  if (desk?.engineTwin && typeof desk.engineTwin === "object") {
    return desk.engineTwin;
  }
  if (engine && typeof engine.instructions === "string") {
    return { element: "engine", model: engine.model ?? null, metadata: {} };
  }
  return null;
}

function soulOf(desk) {
  const engine = desk?.engine ?? null;
  const fromEngine =
    typeof engine?.instructions === "string" ? engine.instructions : null;
  const fromProps =
    typeof desk?.soul?.instructions === "string"
      ? desk.soul.instructions
      : null;
  const instructions = fromEngine ?? fromProps ?? "";
  const source =
    engine?.metadata?.source ?? desk?.soul?.source ?? desk?.source ?? "public";
  const firstLine = instructions.split(/\r?\n/)[0].trim();
  const preview =
    firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  return { instructions, source, preview };
}

function toolsOf(desk) {
  let list = [];
  if (typeof desk?.listTools === "function") {
    try {
      list = desk.listTools();
    } catch {
      list = [];
    }
  } else if (Array.isArray(desk?.tools)) {
    list = desk.tools.map(plainToolSpec).filter(Boolean);
  } else if (Array.isArray(desk?.tools?.list)) {
    list = desk.tools.list.map(plainToolSpec).filter(Boolean);
  }
  const files = desk?.tools?.files ?? desk?.files ?? null;
  const terminal = desk?.tools?.terminal ?? desk?.terminal ?? null;
  return { list, files, terminal };
}

function artifactsOf(desk) {
  if (typeof desk?.listArtifacts === "function") {
    try {
      return desk.listArtifacts();
    } catch {
      return [];
    }
  }
  if (Array.isArray(desk?.artifacts)) {
    return desk.artifacts.map((artifact) =>
      typeof artifact?.twin === "function" ? artifact.twin() : artifact,
    );
  }
  if (desk?.liveArtifact) {
    const twin =
      typeof desk.liveArtifact.twin === "function"
        ? desk.liveArtifact.twin()
        : desk.liveArtifact;
    return twin ? [twin] : [];
  }
  return [];
}

export function templateData(desk = null, messages = []) {
  const session = asArray(messages).map((message) => ({
    role: message?.role ?? "user",
    content: typeof message?.content === "string" ? message.content : "",
  }));
  const twin = engineTwinOf(desk);
  const defaultInference = desk?.defaultInference ?? null;
  const hasDefault = Boolean(
    desk?.hasDefault ?? defaultInference ?? twin?.model,
  );
  const inferenceCount = Number.isFinite(desk?.inferenceCount)
    ? desk.inferenceCount
    : asArray(desk?.inferences).length;
  const agentHistory = asArray(
    desk?.agentHistory ?? desk?.history?.agent ?? [],
  ).map((entry) => ({
    timestamp: entry?.timestamp ?? entry?.at ?? "",
    action: entry?.action ?? "",
    agent: entry?.agent ?? "default",
    path: entry?.path ?? null,
    detail: entry?.detail ?? "",
  }));

  return {
    soul: soulOf(desk),
    agent: {
      model: twin?.model ?? defaultInference?.model ?? null,
      provider: defaultInference?.provider ?? null,
      endpoint: defaultInference?.endpoint ?? null,
      status: hasDefault ? "Ready" : "No model configured",
      hasDefault,
      inferenceCount,
      messageCount: session.length,
      instructionsPreview: twin?.instructionsPreview ?? null,
    },
    history: {
      session,
      agent: agentHistory,
    },
    tools: toolsOf(desk),
    liveArtifacts: artifactsOf(desk),
    // Skills are a placeholder only in this feature: the default
    // desk supplies no skills, so this is exactly []. A later
    // skills feature fills desk.skills without changing the
    // template structure; nothing here invents skill definitions.
    skills: asArray(desk?.skills),
    messages: session,
  };
}
