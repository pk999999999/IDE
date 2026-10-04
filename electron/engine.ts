import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { EngineEvent } from "../src/shared/protocol";

export class JsonLines {
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  push(chunk: Buffer): unknown[] {
    this.buffer += this.decoder.write(chunk);
    const messages: unknown[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > 8 * 1024 * 1024)
        throw new Error("Engine frame exceeds limit");
      if (line.trim()) messages.push(JSON.parse(line));
    }
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024)
      throw new Error("Engine frame exceeds limit");
    return messages;
  }
}

export class EngineBridge extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  private activeAgent?: string;
  private stopped = false;

  async start(
    binary: string,
    root: string,
    keys: Record<string, string>,
  ): Promise<void> {
    this.stopped = false;
    const child = spawn(binary, ["--workspace", root], {
      cwd: root,
      env: { ...process.env, ...keys },
      windowsHide: true,
      stdio: "pipe",
    });
    this.child = child;
    const parser = new JsonLines();
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of parser.push(chunk)) {
          if (!message || typeof message !== "object")
            throw new Error("Invalid engine response");
          const value = message as {
            id?: string;
            event?: string;
            data?: unknown;
            result?: unknown;
            error?: { message: string };
          };
          if (value.event)
            this.emit("event", {
              event: value.event,
              data: value.data,
            } satisfies EngineEvent);
          else if (value.id) {
            const request = this.pending.get(value.id);
            if (request) {
              this.pending.delete(value.id);
              clearTimeout(request.timer);
              if (value.error) request.reject(new Error(value.error.message));
              else request.resolve(value.result);
            }
          }
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) =>
      this.emit("event", {
        event: "engine.log",
        data: { text: chunk.toString("utf8").slice(0, 8192) },
      }),
    );
    child.on("error", (error) =>
      this.fail(new Error(`Engine failed to start: ${error.message}`)),
    );
    child.on("exit", (code, signal) => {
      this.child = undefined;
      this.fail(
        new Error(
          `Engine stopped (${code ?? signal ?? "unknown"}). Reopen the workspace to reconnect.`,
        ),
      );
    });
    child.stdin.on("error", (error) => this.fail(error));
    await this.request("engine.info", {});
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.child || this.stopped)
      return Promise.reject(new Error("Open a workspace to start the engine"));
    if (this.pending.size >= 128)
      return Promise.reject(new Error("Too many pending requests"));
    const id = randomUUID();
    if (method === "engine.cancel") params = { id: this.activeAgent ?? "" };
    const body = JSON.stringify({ id, method, params }) + "\n";
    if (Buffer.byteLength(body) > 8 * 1024 * 1024)
      return Promise.reject(new Error("Request exceeds size limit"));
    const agent = ["agent.plan", "agent.verify"].includes(method);
    if (agent) this.activeAgent = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          this.child?.stdin.write(
            JSON.stringify({
              id: randomUUID(),
              method: "engine.cancel",
              params: { id },
            }) + "\n",
          );
          reject(new Error("Engine request timed out"));
        },
        agent ? 660_000 : 45_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(body, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    }).finally(() => {
      if (this.activeAgent === id) this.activeAgent = undefined;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 15_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
  private fail(error: Error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    if (!this.stopped)
      this.emit("event", {
        event: "engine.error",
        data: { message: error.message },
      });
  }
}
