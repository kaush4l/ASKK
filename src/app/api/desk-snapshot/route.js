// GET /api/desk-snapshot — desk reader + abstract elements, as a twin.
// Returns the snapshot-version desk: agent, soul/instructions sources,
// element strings (toString() as they are NOW), tools, artifact,
// watchers running (from the desk reader's watcher names, none running
// by default in this template), scripts (shared + agent, agent wins),
// models (template only, no real calls, no built-ins, no silent default),
// and default tools. No keys, no apiKeyEnv, no absolute paths.
import { createDesk, publicDesk } from "@/core/desk.js";
import { deskSnapshotTwin, readDeskSnapshot } from "@/core/desk-reader.js";
import {
  artifactElement,
  historyElement,
  instructionsElement,
  modelsElement,
  scriptsElement,
  soulElement,
  toolsElement,
  watchersElement,
} from "@/core/elements.js";
import { mergePlacement } from "@/core/placement.js";
import { listProviders } from "@/core/providers.js";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const agent = url.searchParams.get("agent") ?? "developer";
    const desk = createDesk("personal");
    const snap = readDeskSnapshot({
      personalDir: desk.location,
      defaultsDir: `${process.cwd()}/public/defaults`,
      agent,
    });
    const elements = [
      soulElement(snap.soul),
      instructionsElement(snap.instructions),
      toolsElement(desk.listTools()),
      artifactElement(desk.artifacts?.[0] ? desk.artifacts[0].state() : null),
      watchersElement([]),
      scriptsElement(
        mergePlacement(
          snap.scriptsShared.map((n) => ({ name: n, kind: "shortcut" })),
          snap.scriptsAgent.map((n) => ({ name: n, kind: "shortcut" })),
        ),
      ),
      modelsElement(listProviders(snap.models).providers),
      historyElement([]),
    ];
    const elementStrings = {};
    for (const el of elements) elementStrings[el.id] = el.toString();
    return Response.json({
      twin: deskSnapshotTwin(snap),
      elementStrings,
      providers: listProviders(snap.models),
      scripts: mergePlacement(
        snap.scriptsShared.map((n) => ({ name: n })),
        snap.scriptsAgent.map((n) => ({ name: n })),
      ),
      watchers: mergePlacement(
        snap.watchersShared.map((n) => ({ name: n })),
        snap.watchersAgent.map((n) => ({ name: n })),
      ),
      desk: publicDesk(desk),
      // Default tools, as documented in src/core/README.md: core 16,
      // files + terminal, no web. Listed here as names only.
      defaultTools: desk.listTools().map((t) => t.name),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
