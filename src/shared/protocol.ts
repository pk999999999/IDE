import { z } from "zod";

const path = z.string().min(1).max(4096);
const id = z.string().min(1).max(100);
const empty = z.object({}).strict();
export const modelSchema = z
  .object({
    provider: z.enum(["openai", "anthropic", "gemini"]),
    model: z.string().min(1).max(120),
  })
  .strict();
export const requests = {
  "engine.info": empty,
  "engine.cancel": z.object({ id }).strict(),
  "fs.list": empty,
  "fs.read": z.object({ path }).strict(),
  "fs.write": z
    .object({
      path,
      content: z.string().max(1_048_576),
      expected: z.string().max(1_048_576).nullable(),
    })
    .strict(),
  "fs.rename": z.object({ from: path, to: path }).strict(),
  "fs.delete": z.object({ path }).strict(),
  "fs.search": z.object({ query: z.string().min(1).max(1000) }).strict(),
  "context.search": z.object({ query: z.string().min(1).max(1000) }).strict(),
  "pty.create": z
    .object({
      cols: z.number().int().min(2).max(500),
      rows: z.number().int().min(2).max(300),
    })
    .strict(),
  "pty.write": z.object({ id, text: z.string().max(65536) }).strict(),
  "pty.resize": z
    .object({
      id,
      cols: z.number().int().min(2).max(500),
      rows: z.number().int().min(2).max(300),
    })
    .strict(),
  "pty.close": z.object({ id }).strict(),
  "git.run": z
    .object({
      action: z.enum([
        "status",
        "branches",
        "diff",
        "stage",
        "unstage",
        "commit",
        "switch",
      ]),
      path: path.optional(),
      message: z.string().max(4000).optional(),
      branch: z.string().max(200).optional(),
      staged: z.boolean().optional(),
    })
    .strict(),
  "agent.plan": z
    .object({ model: modelSchema, prompt: z.string().min(1).max(40000) })
    .strict(),
  "agent.stage": z.object({ id }).strict(),
  "agent.apply": z.object({ id, paths: z.array(path).min(1).max(20) }).strict(),
  "agent.reject": z.object({ id, path: path.optional() }).strict(),
  "agent.rollback": z.object({ id, path: path.optional() }).strict(),
  "agent.verify": z.object({ id }).strict(),
  "mcp.start": z
    .object({
      command: z.string().min(1).max(4096),
      args: z.array(z.string().max(4096)).max(50),
    })
    .strict(),
  "mcp.stop": empty,
  "mcp.tools": empty,
  "mcp.call": z
    .object({
      name: z.string().min(1).max(200),
      arguments: z.record(z.unknown()),
    })
    .strict(),
  "lsp.start": z
    .object({
      command: z.string().min(1).max(4096),
      args: z.array(z.string().max(4096)).max(50),
    })
    .strict(),
  "lsp.stop": empty,
  "lsp.request": z
    .object({
      method: z.enum([
        "initialize",
        "shutdown",
        "textDocument/completion",
        "textDocument/hover",
        "textDocument/definition",
        "textDocument/formatting",
      ]),
      params: z.record(z.unknown()),
    })
    .strict(),
  "lsp.notify": z
    .object({
      method: z.enum([
        "initialized",
        "exit",
        "textDocument/didOpen",
        "textDocument/didChange",
        "textDocument/didClose",
        "textDocument/didSave",
      ]),
      params: z.record(z.unknown()),
    })
    .strict(),
} as const;
export type Method = keyof typeof requests;
export type Params<M extends Method> = z.input<(typeof requests)[M]>;
export type Provider = z.infer<typeof modelSchema>["provider"];
export type Model = z.infer<typeof modelSchema>;
export interface EngineEvent {
  event: string;
  data: unknown;
}
export interface FileEntry {
  path: string;
  size: number;
}
export interface Change {
  path: string;
  content: string | null;
  original: string | null;
  reason: string;
  line?: number;
  diff: string;
  state: "pending" | "applied" | "rejected" | "rolled_back";
}
export interface Plan {
  id: string;
  title: string;
  steps: string[];
  changes: Change[];
  verification: string[];
  status: "proposed" | "approved";
}
export interface DesktopAPI {
  readonly platform: string;
  request<M extends Method, T = unknown>(
    method: M,
    params: Params<M>,
  ): Promise<T>;
  subscribe(listener: (event: EngineEvent) => void): () => void;
  openWorkspace(): Promise<{ root: string } | null>;
  keyStatus(): Promise<Record<Provider, boolean>>;
  saveKey(provider: Provider, key: string): Promise<void>;
  window(action: "minimize" | "maximize" | "close"): void;
}
export function validateRequest(method: string, params: unknown) {
  if (!Object.prototype.hasOwnProperty.call(requests, method))
    throw new Error("Unsupported engine method");
  return requests[method as Method].parse(params);
}
export function isPreviewURL(input: string) {
  try {
    const u = new URL(input);
    return (
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
