import { test, expect } from "bun:test";
import { events } from "./api.js";

class FakeES {
  static all = [];
  constructor(u) { this.u = u; this.l = {}; FakeES.all.push(this); }
  addEventListener(n, f) { this.l[n] = f; }
  close() { this.closed = true; }
}

test("events reports a reconnect so the store re-reads /world", async () => {
  FakeES.all = [];
  const opens = [];
  const stop = events({ open: (again) => opens.push(again) }, FakeES);
  FakeES.all[0].onopen();
  FakeES.all[0].onerror();
  await new Promise((r) => setTimeout(r, 1100)); // backoff 1 s
  FakeES.all[1].onopen();
  stop();
  expect(opens).toEqual([false, true]);
});
