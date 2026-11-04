// TOON — the default response format.
//
// A reply is lines of:
//   thought: <free text>
//   call: <tool.name> {"input": ...}
//   <answer text>
//
// parseReply(text) -> { thought, calls: [{ name, input }], answer }.
// Rules, in order:
//   1. Valid thought:/call: lines are parsed. A call line whose
//      input is not valid JSON is NOT invented around: the whole
//      reply falls back (rule 2) instead of guessing a call.
//   2. JSON fallback: if no valid TOON lines were found, and the
//      whole text parses as JSON, calls/answer/thought are taken
//      from that object when present.
//   3. Otherwise the whole text is the answer, with no calls.
// A reply never silently invents a call: a malformed call line
// yields zero calls, and the text is preserved as the answer.

const CALL_RE = /^call:\s*([A-Za-z0-9_.-]+)\s*(.*)$/;
const THOUGHT_RE = /^thought:\s*(.*)$/;

function callsFromJson(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value.calls ?? value.toolCalls ?? null;
  if (!Array.isArray(raw)) {
    return null;
  }
  const calls = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      calls.push({ name: entry, input: {} });
    } else if (entry && typeof entry.name === "string") {
      calls.push({
        name: entry.name,
        input:
          entry.input && typeof entry.input === "object" ? entry.input : {},
      });
    } else {
      return null;
    }
  }
  return calls;
}

export function parseReply(text) {
  if (typeof text !== "string") {
    return { thought: "", calls: [], answer: "" };
  }
  const lines = text.split(/\r?\n/);
  const thoughtParts = [];
  const calls = [];
  const answerParts = [];
  let sawToon = false;
  let malformedCall = false;
  for (const line of lines) {
    const thought = line.match(THOUGHT_RE);
    if (thought) {
      sawToon = true;
      thoughtParts.push(thought[1]);
      continue;
    }
    const call = line.match(CALL_RE);
    if (call) {
      sawToon = true;
      const rest = call[2].trim();
      if (rest === "") {
        calls.push({ name: call[1], input: {} });
      } else {
        try {
          const parsed = JSON.parse(rest);
          calls.push({
            name: call[1],
            input:
              parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : { value: parsed },
          });
        } catch {
          malformedCall = true;
        }
      }
      continue;
    }
    answerParts.push(line);
  }
  if (sawToon && !malformedCall) {
    return {
      thought: thoughtParts.join("\n").trim(),
      calls,
      answer: answerParts.join("\n").trim(),
    };
  }
  // JSON fallback (also the path for a malformed call line: the
  // text is kept as the answer, with no invented call).
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const jsonCalls = callsFromJson(parsed);
      if (jsonCalls !== null) {
        return {
          thought: typeof parsed.thought === "string" ? parsed.thought : "",
          calls: jsonCalls,
          answer: typeof parsed.answer === "string" ? parsed.answer : "",
        };
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.answer === "string"
      ) {
        return { thought: "", calls: [], answer: parsed.answer };
      }
    } catch {
      // Not JSON either: fall through to plain answer.
    }
  }
  return { thought: "", calls: [], answer: text.trim() };
}

export function formatReply({ thought = "", calls = [], answer = "" } = {}) {
  const lines = [];
  if (thought) {
    lines.push(`thought: ${thought}`);
  }
  for (const call of calls ?? []) {
    lines.push(`call: ${call.name} ${JSON.stringify(call.input ?? {})}`);
  }
  if (answer) {
    lines.push(answer);
  }
  return lines.join("\n");
}
