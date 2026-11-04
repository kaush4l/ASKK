import { describe, expect, test } from "bun:test";
import { formatReply, parseReply } from "./toon.js";

describe("TOON default response format", () => {
  test("valid TOON parsed: thought, parallel calls, answer", () => {
    const parsed = parseReply(
      'thought: edit the file\ncall: files.open {"paths":["a.txt"]}\ncall: files.read {"path":"a.txt"}\nDone.',
    );
    expect(parsed.thought).toBe("edit the file");
    expect(parsed.calls).toEqual([
      { name: "files.open", input: { paths: ["a.txt"] } },
      { name: "files.read", input: { path: "a.txt" } },
    ]);
    expect(parsed.answer).toBe("Done.");
  });

  test("invalid TOON falls back to JSON, then to plain answer, never inventing a call", () => {
    const bad = parseReply('call: files.edit {"path": broken}');
    expect(bad.calls).toEqual([]);
    expect(bad.answer).toContain("files.edit");
    const json = parseReply(
      '{"thought":"hi","calls":[{"name":"files.read","input":{"path":"a"}}],"answer":"ok"}',
    );
    expect(json.calls).toEqual([{ name: "files.read", input: { path: "a" } }]);
    expect(json.answer).toBe("ok");
    const plain = parseReply("just an answer");
    expect(plain.calls).toEqual([]);
    expect(plain.answer).toBe("just an answer");
  });

  test("formatReply round-trips through parseReply", () => {
    const text = formatReply({
      thought: "thinking",
      calls: [{ name: "files.list", input: {} }],
      answer: "done",
    });
    const parsed = parseReply(text);
    expect(parsed.thought).toBe("thinking");
    expect(parsed.calls).toEqual([{ name: "files.list", input: {} }]);
    expect(parsed.answer).toBe("done");
  });
});
