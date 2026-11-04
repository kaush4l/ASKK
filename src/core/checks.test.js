import { describe, expect, test } from "bun:test";
import { runChecks } from "./checks.js";

describe("dev checks", () => {
  test("mocked runner records name, command, status, exit, tail; failure is a failure", () => {
    const out = runChecks({
      run: (command) =>
        command.includes("bun test")
          ? { exit: 0, output: "110 pass\n0 fail\n" }
          : { exit: 1, output: "error: build failed\nline 2\n" },
    });
    expect(out.passed).toBe(false);
    expect(out.checks).toHaveLength(2);
    expect(out.checks[0]).toMatchObject({
      name: "bun test src/core",
      status: "passed",
      exit: 0,
    });
    expect(out.checks[1].status).toBe("failed");
    expect(out.checks[1].tail).toContain("build failed");
    expect(out.failed).toHaveLength(1);
  });

  test("all passing mocked checks pass", () => {
    const out = runChecks({ run: () => ({ exit: 0, output: "ok" }) });
    expect(out.passed).toBe(true);
  });
});
