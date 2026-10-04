import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const root = await mkdtemp(join(tmpdir(), "degravity-smoke-"));
const binary = resolve(
  `resources/bin/antigravity-engine${process.platform === "win32" ? ".exe" : ""}`,
);
const child = spawn(binary, ["--workspace", root], {
  stdio: "pipe",
  windowsHide: true,
});
const waiting = new Map();
let next = 0;
let terminalOutput = "";
child.stderr.on("data", (data) => process.stderr.write(data));
child.on("error", (error) => {
  for (const promise of waiting.values()) promise.reject(error);
});
createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (process.env.DEGRAVITY_SMOKE_DEBUG) process.stderr.write(`${line}\n`);
  if (message.event === "pty.data") {
    const chunk = Buffer.from(message.data.base64, "base64").toString("utf8");
    terminalOutput += chunk;
    // Windows ConPTY asks the terminal for its cursor position before CMD starts.
    if (chunk.includes("\x1b[6n"))
      void request("pty.write", { id: message.data.id, text: "\x1b[1;1R" }).catch(() => {});
  }
  if (message.id && waiting.has(message.id)) {
    const pending = waiting.get(message.id);
    waiting.delete(message.id);
    clearTimeout(pending.timer);
    message.error
      ? pending.reject(new Error(message.error.message))
      : pending.resolve(message.result);
  }
});
function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++next);
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 20000);
    waiting.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  await writeFile(join(root, ".gitignore"), "ignored.txt\n");
  await writeFile(join(root, "ignored.txt"), "not indexed");
  assert.equal((await request("engine.info")).protocol, 1);
  await request("fs.write", {
    path: "src/main.ts",
    content: "hello",
    expected: null,
  });
  assert.equal(
    (await request("fs.read", { path: "src/main.ts" })).content,
    "hello",
  );
  await assert.rejects(
    request("fs.write", {
      path: "src/main.ts",
      content: "clobber",
      expected: "stale",
    }),
  );
  await assert.rejects(
    request("fs.write", { path: "../escape", content: "no", expected: null }),
  );
  assert(
    !(await request("fs.list")).some((file) => file.path === "ignored.txt"),
  );
  const pty = await request("pty.create", { cols: 80, rows: 24 });
  await request("pty.write", { id: pty.id, text: "echo DEGRAVITY_PTY_OK\r" });
  const deadline = Date.now() + 10000;
  while (!terminalOutput.includes("DEGRAVITY_PTY_OK") && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
  assert(terminalOutput.includes("DEGRAVITY_PTY_OK"), "PTY returned no output");
  // A prompt may show an aliased Windows temp path. Probe the actual shell cwd.
  const probe = "degravity-pty-cwd-probe.txt";
  await request("pty.write", {
    id: pty.id,
    text: `echo DEGRAVITY_CWD_OK > ${probe}\r`,
  });
  const cwdDeadline = Date.now() + 10000;
  let probeContent = "";
  while (!probeContent.includes("DEGRAVITY_CWD_OK") && Date.now() < cwdDeadline) {
    probeContent = await readFile(join(root, probe), "utf8").catch(() => "");
    if (!probeContent.includes("DEGRAVITY_CWD_OK"))
      await new Promise((r) => setTimeout(r, 50));
  }
  assert(
    probeContent.includes("DEGRAVITY_CWD_OK"),
    `PTY started outside the workspace; output: ${terminalOutput.slice(-1000)}`,
  );
  await request("pty.resize", { id: pty.id, cols: 100, rows: 30 });
  await request("pty.close", { id: pty.id });
  await request("fs.rename", { from: "src/main.ts", to: "src/renamed.ts" });
  await request("fs.delete", { path: "src/renamed.ts" });
  console.log(
    "Engine smoke passed: IPC, workspace confinement, stale-write protection, gitignore, PTY I/O and lifecycle.",
  );
} finally {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 16000);
  await exited;
  clearTimeout(timer);
  await rm(root, { recursive: true, force: true });
}
