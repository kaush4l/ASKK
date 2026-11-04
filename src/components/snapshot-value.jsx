// SnapshotValue — generic fallback rendering for unknown fields.
//
// Per-kind components (engine-component, tool-component,
// artifact-component) render their own known fields first and
// use this ONLY for fields they do not know. It must never be
// the only UI for a core kind: engine, tool, and artifact each
// have their own component.

function shortText(text) {
  if (typeof text !== "string") return text;
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

export default function SnapshotValue({ value, depth = 0 }) {
  if (value === null || value === undefined) {
    return <span className="text-zinc-400">—</span>;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return <span>{shortText(String(value))}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-zinc-400">none</span>;
    }
    if (depth >= 3) {
      return <span>{value.length} items</span>;
    }
    return (
      <ul className="flex flex-col gap-1 pl-4">
        {value.slice(0, 20).map((entry) => (
          <li
            key={typeof entry === "string" ? entry : JSON.stringify(entry)}
            className="list-disc text-sm"
          >
            <SnapshotValue value={entry} depth={depth + 1} />
          </li>
        ))}
        {value.length > 20 && (
          <li className="text-sm text-zinc-500">
            … and {value.length - 20} more
          </li>
        )}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-zinc-400">none</span>;
    }
    if (depth >= 3) {
      return <span>{entries.length} fields</span>;
    }
    return (
      <dl className="flex flex-col gap-1">
        {entries.map(([key, entry]) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium text-zinc-500">{key}</dt>
            <dd className="text-sm">
              <SnapshotValue value={entry} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}
