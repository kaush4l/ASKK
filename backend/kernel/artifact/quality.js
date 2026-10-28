import { Artifact } from "./artifact.js"
import { scoreReport } from "../agent/report.js"

// QualityMatrix: a lead's view of its members' reports, scored in code the moment each report
// lands (report.js scoreReport: format, numbers, sources, confidence, falsifier — 0..5). No LLM
// call; the lead sees who to re-quest. Kept for the day (not reset per run).
export class QualityMatrix extends Artifact {
  static about = "a quality bar scored per criterion"
  constructor({ id, title, owner = null }) {
    super({ name: id, title: title ?? id })
    this.kind = "quality"
    this.view = "quality"
    this.owner = owner
    this.state = { rows: {} }
  }

  attach(agent) {
    agent.on("result", (e) => {
      const tool = agent.tools.get(e.tool)
      if (!tool?.agent) return
      const s = scoreReport(e.output)
      this.state = { rows: { ...this.state.rows, [e.tool]: { score: s.score, parts: s.parts, verdict: s.verdict, confidence: s.confidence, ok: e.ok, at: new Date().toISOString() } } }
      this.changed()
    })
  }

  brief() {
    return Object.entries(this.state.rows).map(([m, r]) => `${m} ${r.score}/5`).join(" · ")
  }

  render() {
    const rows = Object.entries(this.state.rows)
    const head = "your members' reports, scored in code 0–5 (format · ≥2 numbers · (tool, time) sources · confidence 0–1 · a falsifier that names a level or event): re-quest a member below 3"
    if (!rows.length) return `${head}\n(no reports yet)`
    return [head, ...rows
      .map(([m, r]) => `${m}: ${r.score}/5${r.score < 5 ? ` missing ${Object.entries(r.parts).filter(([, v]) => !v).map(([k]) => k).join(",")}` : ""}${r.confidence != null ? ` · conf ${r.confidence}` : ""}`)
    ].join("\n")
  }
}
