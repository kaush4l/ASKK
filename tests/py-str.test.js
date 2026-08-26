/**
 * Python's `str`, `repr` and truthiness.
 *
 * Every expectation in here was executed against CPython 3.14 in the source
 * tree's own `.venv` and pasted back — not reasoned about. Four claims of
 * reproduced Python string semantics were false before this file existed, and
 * all four were found by running the two trees side by side.
 */

import { test, expect } from "bun:test";

import { pyRepr, pyStr, pyStrOr, pyTruthy } from "../core/py-str.js";

// ── truthiness ───────────────────────────────────────────────────────────

test("an empty container is empty, which is the half `??` and `||` both miss", () => {
  for (const empty of [null, undefined, false, 0, -0, NaN, "", [], {}]) {
    expect(pyTruthy(empty)).toBe(false);
    expect(pyStrOr(empty)).toBe("");
  }
  for (const full of [true, 1, -1, "x", [0], { a: 0 }]) expect(pyTruthy(full)).toBe(true);
});

// ── str ──────────────────────────────────────────────────────────────────

test("str() of a scalar carries Python's spelling, not JavaScript's", () => {
  expect(pyStr(true)).toBe("True");
  expect(pyStr(false)).toBe("False");
  expect(pyStr(null)).toBe("None");
  expect(pyStr(undefined)).toBe("None");
  expect(pyStr(1)).toBe("1");
  expect(pyStr(1.5)).toBe("1.5");
  expect(pyStr("already a string")).toBe("already a string");
});

test("str() of a container is Python's repr, not `[object Object]` or `a,b`", () => {
  expect(pyStr({ goal: "x" })).toBe("{'goal': 'x'}");
  expect(pyStr(["hello", "there"])).toBe("['hello', 'there']");
  expect(pyStr([1, 2])).toBe("[1, 2]");
  expect(pyStr([])).toBe("[]");
  expect(pyStr({})).toBe("{}");
  // measured: str({"a": [1, {"b": None}], "c": True})
  expect(pyStr({ a: [1, { b: null }], c: true })).toBe("{'a': [1, {'b': None}], 'c': True}");
});

// ── repr ─────────────────────────────────────────────────────────────────

test("repr() switches to double quotes around an apostrophe, and only then", () => {
  expect(pyRepr("b")).toBe("'b'");
  expect(pyRepr("it's broken")).toBe('"it\'s broken"');
  expect(pyRepr('say "hi"')).toBe("'say \"hi\"'");
  // both quotes present: single wins and the apostrophe is escaped
  expect(pyRepr("both ' and \"")).toBe("'both \\' and \"'");
});

test("repr() escapes the way Python escapes", () => {
  expect(pyRepr("back\\slash")).toBe("'back\\\\slash'");
  expect(pyRepr("line\nbreak")).toBe("'line\\nbreak'");
  expect(pyRepr("tab\there")).toBe("'tab\\there'");
  expect(pyRepr("\r")).toBe("'\\r'");
  expect(pyRepr(`${String.fromCharCode(1)}ctl`)).toBe("'\\x01ctl'");
  expect(pyRepr(String.fromCharCode(31))).toBe("'\\x1f'");
});

test("repr() of a non-string is str()", () => {
  expect(pyRepr(7)).toBe("7");
  expect(pyRepr(["a"])).toBe("['a']");
});
