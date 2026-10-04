import { describe, expect, it } from "vitest";
import { validateRequest, isPreviewURL } from "../src/shared/protocol";
import { JsonLines } from "../electron/engine";
import { fileURI } from "../src/lib/utils";
import { modelFor, selectConfiguredModel } from "../src/lib/models";
import { parseGitStatus } from "../src/components/WorkspacePanels";

describe("IPC boundary", () => {
  it("rejects arbitrary methods, extra arguments and oversized terminal input", () => {
    expect(() => validateRequest("shell.exec", {})).toThrow();
    expect(() => validateRequest("__proto__", {})).toThrow();
    expect(() =>
      validateRequest("fs.read", { path: "src/a.ts", root: "C:/" }),
    ).toThrow();
    expect(() =>
      validateRequest("pty.write", { id: "x", text: "x".repeat(65537) }),
    ).toThrow();
    expect(() =>
      validateRequest("lsp.request", {
        method: "workspace/executeCommand",
        params: {},
      }),
    ).toThrow();
  });
  it("requires a save precondition to avoid losing external changes", () => {
    expect(() =>
      validateRequest("fs.write", { path: "x", content: "new" }),
    ).toThrow();
    expect(
      validateRequest("fs.write", {
        path: "x",
        content: "new",
        expected: null,
      }),
    ).toEqual({ path: "x", content: "new", expected: null });
  });
  it("allows a Meta Llama plan through the validated IPC boundary", () => {
    const request = {
      model: {
        provider: "llama",
        model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
      },
      prompt: "Explain this file",
    };
    expect(validateRequest("agent.plan", request)).toEqual(request);
  });
});
describe("embedded preview isolation", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:5173/a",
    "http://[::1]:8080",
  ])("allows %s", (url) => expect(isPreviewURL(url)).toBe(true));
  it.each([
    "file:///etc/passwd",
    "https://example.com",
    "http://localhost.evil.test",
    "http://user:pass@localhost",
    "javascript:alert(1)",
    "http://0.0.0.0:3000",
  ])("rejects %s", (url) => expect(isPreviewURL(url)).toBe(false));
});
describe("stream transport", () => {
  it("decodes partial UTF-8 and multiple frames", () => {
    const parser = new JsonLines();
    const bytes = Buffer.from('{"event":"héllo"}\n{"id":"2","result":{}}\n');
    const messages = [];
    for (const byte of bytes)
      messages.push(...parser.push(Buffer.from([byte])));
    expect(messages).toEqual([{ event: "héllo" }, { id: "2", result: {} }]);
  });
  it("rejects corrupt frames", () =>
    expect(() => new JsonLines().push(Buffer.from("{broken}\n"))).toThrow());
});
it("creates encoded file URIs on Windows and POSIX", () => {
  expect(fileURI("C:\\repo space", "src/a#b.ts")).toBe(
    "file:///C:/repo%20space/src/a%23b.ts",
  );
  expect(fileURI("/home/user/repo", "a.ts")).toBe(
    "file:///home/user/repo/a.ts",
  );
});
it("parses NUL-delimited Git paths, including rename source records", () => {
  expect(
    parseGitStatus(
      "R  new name.ts\0old name.ts\0?? hello world.ts\0 M code.ts\0",
    ),
  ).toEqual([
    { path: "new name.ts", index: "R", worktree: " " },
    { path: "hello world.ts", index: "?", worktree: "?" },
    { path: "code.ts", index: " ", worktree: "M" },
  ]);
});
it("automatically selects the only configured provider without replacing a chosen model", () => {
  const current = modelFor("openai");
  expect(
    selectConfiguredModel(current, {
      openai: false,
      anthropic: false,
      gemini: false,
      llama: true,
      meta: false,
    }),
  ).toEqual(modelFor("llama"));
  expect(
    selectConfiguredModel(
      { provider: "llama", model: "my-custom-model" },
      { openai: false, anthropic: false, gemini: false, llama: true, meta: false },
    ),
  ).toEqual({ provider: "llama", model: "my-custom-model" });
  expect(
    selectConfiguredModel(current, {
      openai: false,
      anthropic: true,
      gemini: false,
      llama: true,
      meta: false,
    }),
  ).toEqual(current);
  expect(
    selectConfiguredModel(current, {
      openai: false,
      anthropic: false,
      gemini: false,
      llama: true,
      meta: true,
    }),
  ).toEqual(modelFor("meta"));
});
