import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import {
  TUTOR_APP_SERVER_ARGS,
  TUTOR_PROCESS_DISABLED_FEATURES,
  terminateChildProcessTree,
} from "./codex-app-server-client";

describe("Tutor app-server process profile", () => {
  it("disables unrelated built-in capabilities before the process accepts a thread", () => {
    for (const feature of TUTOR_PROCESS_DISABLED_FEATURES) {
      expect(TUTOR_APP_SERVER_ARGS).toEqual(
        expect.arrayContaining(["--disable", feature]),
      );
    }
    expect(TUTOR_APP_SERVER_ARGS).toEqual(
      expect.arrayContaining([
        "--enable",
        "realtime_conversation",
        'web_search="disabled"',
      ]),
    );
  });
});

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("Tutor app-server process cleanup", () => {
  it("waits for and terminates a real child process tree", async () => {
    const script = [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });',
      "process.stdout.write(String(child.pid) + '\\n');",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const parent = spawn(process.execPath, ["-e", script], {
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    const childPid = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("fixture pid timeout")), 3_000);
      parent.stdout.once("data", (chunk) => {
        clearTimeout(timeout);
        resolve(Number(String(chunk).trim()));
      });
      parent.once("error", reject);
    });
    expect(processIsAlive(parent.pid!)).toBe(true);
    expect(processIsAlive(childPid)).toBe(true);
    try {
      await terminateChildProcessTree(parent, 500);
      await vi.waitFor(() => expect(processIsAlive(parent.pid!)).toBe(false));
      await vi.waitFor(() => expect(processIsAlive(childPid)).toBe(false));
    } finally {
      if (processIsAlive(parent.pid!)) parent.kill("SIGKILL");
      if (processIsAlive(childPid)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // The fixture child already exited.
        }
      }
    }
  }, 10_000);
});
