import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, chmodSync } from "node:fs";
const result = spawnSync(
  "cargo",
  ["build", "--release", "--locked", "--package", "antigravity-engine"],
  { stdio: "inherit" },
);
if (result.error) {
  console.error("Install the Rust stable toolchain:", result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
const name = `antigravity-engine${process.platform === "win32" ? ".exe" : ""}`;
mkdirSync("resources/bin", { recursive: true });
copyFileSync(`target/release/${name}`, `resources/bin/${name}`);
if (process.platform !== "win32") chmodSync(`resources/bin/${name}`, 0o755);
