import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import electron from "electron";
await import("./build-electron.mjs");
const binary = `resources/bin/antigravity-engine${process.platform === "win32" ? ".exe" : ""}`;
if (!existsSync(binary)) {
  console.error("First run npm run build:engine");
  process.exit(1);
}
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { stdio: "inherit" },
);
let app;
const stop = () => {
  app?.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (let attempt = 0; attempt < 80; attempt++) {
  try {
    if ((await fetch("http://127.0.0.1:5173")).ok) break;
  } catch {}
  if (attempt === 79) {
    stop();
    throw new Error("Vite startup timeout");
  }
  await new Promise((r) => setTimeout(r, 250));
}
app = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, DEGRAVITY_DEV_URL: "http://127.0.0.1:5173" },
});
app.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
