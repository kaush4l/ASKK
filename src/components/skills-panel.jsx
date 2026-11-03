// Skills panel — PLACEHOLDER ONLY, explicitly not built in this
// feature. It renders the Skills section of the desk template as
// an empty list plus the later-note, so a future skills feature
// can fill it without changing the template structure. No skill
// definitions, loaders, or routes exist yet; do not invent any.
"use client";

export default function SkillsPanel({ skills = [] }) {
  const list = Array.isArray(skills) ? skills : [];
  return (
    <div className="flex flex-col gap-2 text-sm">
      {list.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Skills will be added later.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((skill) => (
            <li key={skill?.name ?? skill} className="font-mono">
              {skill?.name ?? skill}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
