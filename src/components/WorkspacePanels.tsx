import { useEffect, useState } from "react";
import * as monaco from "monaco-editor";
import {
  Check,
  GitBranch,
  Globe,
  KeyRound,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";
import { useStudio } from "../store";
import { rpc } from "../lib/api";
import { startLsp } from "../lib/lsp";
import { isPreviewURL, type Provider } from "../shared/protocol";
import { Button } from "./ui/button";

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<
    { path: string; line: number; text: string }[]
  >([]);
  const s = useStudio();
  return (
    <>
      <div className="panel-heading">GLOBAL SEARCH</div>
      <form
        className="p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void rpc<typeof matches>("fs.search", { query })
            .then(setMatches)
            .catch(s.report);
        }}
      >
        <div className="flex gap-1">
          <input
            className="field min-w-0 flex-1"
            placeholder="Find in workspace"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" size="icon" disabled={!s.connected || !query}>
            <Search size={14} />
          </Button>
        </div>
      </form>
      <div className="overflow-auto">
        {matches.map((m, i) => (
          <button
            key={i}
            className="block w-full border-b border-border px-3 py-3 text-left hover:bg-white/5"
            onClick={() => void s.open(m.path)}
          >
            <div className="truncate text-[10px] text-primary">
              {m.path}:{m.line}
            </div>
            <p className="mt-1 truncate text-[11px] text-[#9ba5bb]">{m.text}</p>
          </button>
        ))}
        <p className="p-3 text-[10px] text-[#68758d]">
          {matches.length} results · maximum 500
        </p>
      </div>
    </>
  );
}
export function parseGitStatus(text: string) {
  const records = text.split("\0");
  const files: { path: string; index: string; worktree: string }[] = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    if (!row || row.length < 4) continue;
    const index = row[0]!,
      worktree = row[1]!;
    files.push({ path: row.slice(3), index, worktree });
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C")
      i++;
  }
  return files;
}
export function SourceControl() {
  const s = useStudio();
  const [files, setFiles] = useState<ReturnType<typeof parseGitStatus>>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [message, setMessage] = useState("");
  const [diff, setDiff] = useState("");
  const [working, setWorking] = useState(false);
  const refresh = async () => {
    if (!s.connected) return;
    try {
      const [status, branches] = await Promise.all([
        rpc<{ stdout: string }>("git.run", { action: "status" }),
        rpc<{ stdout: string }>("git.run", { action: "branches" }),
      ]);
      setFiles(parseGitStatus(status.stdout));
      const names = branches.stdout.trimEnd().split("\n").filter(Boolean);
      setBranch(
        names
          .find((b) => b.startsWith("*"))
          ?.slice(1)
          .trim() ?? "",
      );
      setBranches(names.map((b) => b.slice(1).trim()));
    } catch (e) {
      s.report(e);
    }
  };
  useEffect(() => {
    void refresh();
  }, [s.root, s.connected]);
  const act = async (
    action: "stage" | "unstage" | "commit" | "switch",
    extra: Record<string, string>,
  ) => {
    setWorking(true);
    try {
      await rpc("git.run", { action, ...extra });
      setMessage("");
      await refresh();
      await s.refresh();
    } catch (e) {
      s.report(e);
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <div className="panel-heading">
        <span>SOURCE CONTROL</span>
        <Button
          variant="ghost"
          size="icon"
          title="Refresh Git"
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} />
        </Button>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-primary" />
          <select
            className="field min-w-0 flex-1"
            aria-label="Git branch"
            value={branch}
            disabled={working}
            onChange={(e) => {
              if (s.documents.some((d) => d.content !== d.saved)) {
                s.report(
                  "Save or close edited files before switching branches.",
                );
                return;
              }
              void act("switch", { branch: e.target.value });
            }}
          >
            <option value="" disabled>
              Choose branch
            </option>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <textarea
          rows={3}
          className="field w-full resize-none"
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button
          className="w-full"
          disabled={working || !message.trim()}
          onClick={() => void act("commit", { message })}
        >
          <Check size={13} />
          Commit staged changes
        </Button>
        <p className="text-[10px] text-[#6e7b94]">
          Git hooks and signing are disabled in this panel. Use the terminal
          when needed.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-1 px-3 py-1.5 text-xs"
          >
            <span className="w-6 shrink-0 font-mono text-amber-300">
              {file.index}
              {file.worktree}
            </span>
            <button
              className="min-w-0 flex-1 truncate text-left text-[#a9b2c6]"
              onClick={() =>
                void rpc<{ stdout: string }>("git.run", {
                  action: "diff",
                  path: file.path,
                  staged: file.index !== " " && file.index !== "?",
                })
                  .then((r) =>
                    setDiff(
                      r.stdout ||
                        "No tracked diff. Open new files in the editor.",
                    ),
                  )
                  .catch(s.report)
              }
            >
              {file.path}
            </button>
            <button
              title="Stage file"
              disabled={working}
              onClick={() => void act("stage", { path: file.path })}
            >
              <Plus size={13} />
            </button>
            <button
              title="Unstage file"
              disabled={working || file.index === "?" || file.index === " "}
              onClick={() => void act("unstage", { path: file.path })}
            >
              <Minus size={13} />
            </button>
          </div>
        ))}
        {!files.length && (
          <p className="px-4 py-6 text-xs text-[#75819a]">
            No changes to display.
          </p>
        )}
        {diff && (
          <pre className="m-2 overflow-x-auto whitespace-pre-wrap rounded border border-border p-2 text-[10px] leading-5 text-[#a0b8af]">
            {diff}
          </pre>
        )}
      </div>
    </>
  );
}

export function SettingsPanel() {
  const s = useStudio();
  const [status, setStatus] = useState<Record<Provider, boolean>>({
    openai: false,
    anthropic: false,
    gemini: false,
  });
  const [key, setKey] = useState("");
  const [command, setCommand] = useState("typescript-language-server");
  const [args, setArgs] = useState('["--stdio"]');
  useEffect(() => {
    void window.studio?.keyStatus().then(setStatus).catch(s.report);
  }, []);
  return (
    <>
      <div className="panel-heading">SETTINGS</div>
      <div className="space-y-5 overflow-auto p-4 text-xs">
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-[#cbd0e0]">
            <KeyRound size={14} />
            Model provider
          </h3>
          <select
            aria-label="Provider"
            className="field w-full"
            value={s.model.provider}
            onChange={(e) =>
              s.set({
                model: {
                  provider: e.target.value as Provider,
                  model:
                    e.target.value === "openai"
                      ? "gpt-4.1"
                      : e.target.value === "anthropic"
                        ? "claude-sonnet-4-20250514"
                        : "gemini-2.5-pro",
                },
              })
            }
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Google Gemini</option>
          </select>
          <label className="mt-3 block text-[10px] text-[#8190ab]">
            Model ID
            <input
              className="field mt-1 w-full"
              value={s.model.model}
              onChange={(e) =>
                s.set({ model: { ...s.model, model: e.target.value } })
              }
            />
          </label>
          <p className="mt-2 text-[10px] text-[#6d7b94]">
            Use a model available to your account.
          </p>
          <label className="mt-3 block text-[10px] text-[#8190ab]">
            API key ·{" "}
            {status[s.model.provider] ? "configured" : "not configured"}
            <input
              type="password"
              autoComplete="off"
              className="field mt-1 w-full"
              placeholder="Paste a key to replace"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <Button
            className="mt-2 w-full"
            variant="outline"
            disabled={!key.trim()}
            onClick={() =>
              void window.studio
                .saveKey(s.model.provider, key.trim())
                .then(async () => {
                  setKey("");
                  setStatus(await window.studio.keyStatus());
                  s.log("Credential saved. Reopen the workspace to apply it.");
                })
                .catch(s.report)
            }
          >
            Save encrypted key
          </Button>
          <p className="mt-2 text-[10px] leading-5 text-[#64738d]">
            Stored using your OS credential protection. Reopen the workspace
            after changing keys.
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-[#cbd0e0]">Language server</h3>
          <input
            className="field w-full"
            aria-label="Language server executable"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <input
            className="field mt-2 w-full font-mono"
            aria-label="Language server arguments as JSON"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
          <Button
            variant="outline"
            className="mt-2 w-full"
            disabled={!s.connected}
            onClick={() => {
              try {
                const parsed: unknown = JSON.parse(args);
                if (
                  !Array.isArray(parsed) ||
                  !parsed.every((a) => typeof a === "string")
                )
                  throw new Error("Arguments must be a JSON string array.");
                void startLsp(command, parsed, monaco).catch(s.report);
              } catch (e) {
                s.report(e);
              }
            }}
          >
            {s.lsp ? "Restart" : "Connect"} LSP
          </Button>
          <p className="mt-2 text-[10px] leading-5 text-[#64738d]">
            Install the server separately. Provides diagnostics, completion and
            hover for the active document. One server per workspace.
          </p>
        </div>
      </div>
    </>
  );
}
export function MCPPanel() {
  const s = useStudio();
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [connected, setConnected] = useState(false);
  const [tools, setTools] = useState<
    { name: string; description?: string; inputSchema?: unknown }[]
  >([]);
  const [result, setResult] = useState("");
  const [selected, setSelected] = useState("");
  const [argumentsJSON, setArgumentsJSON] = useState("{}");
  useEffect(() => {
    setConnected(false);
    setTools([]);
  }, [s.root]);
  const connect = async () => {
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every((a) => typeof a === "string"))
        throw new Error("Arguments must be a JSON string array.");
      await rpc("mcp.start", { command, args: parsed });
      const result = await rpc<{ tools: typeof tools }>("mcp.tools", {});
      setTools(result.tools);
      setConnected(true);
    } catch (e) {
      s.report(e);
    }
  };
  return (
    <>
      <div className="panel-heading">MCP SERVERS</div>
      <div className="space-y-3 overflow-y-auto p-4 text-xs">
        <Server size={22} className="mb-3 text-primary" />
        <p className="leading-6 text-[#8290a8]">
          Connect a local stdio MCP server. Each tool invocation requires
          approval.
        </p>
        <input
          className="field w-full"
          aria-label="MCP executable"
          placeholder="Executable path"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <input
          className="field w-full font-mono"
          aria-label="MCP argument JSON array"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
        />
        <Button
          className="w-full"
          variant="outline"
          disabled={!command || !s.connected}
          onClick={() => void connect()}
        >
          {connected ? "Reconnect" : "Connect server"}
        </Button>
        {tools.map((tool) => (
          <button
            className={`block w-full rounded border p-3 text-left ${selected === tool.name ? "border-primary/40" : "border-border"}`}
            key={tool.name}
            onClick={() => setSelected(tool.name)}
          >
            <p className="text-primary">{tool.name}</p>
            <p className="mt-2 text-[10px] leading-5 text-[#7a88a0]">
              {tool.description}
            </p>
          </button>
        ))}
        {selected && (
          <>
            <pre className="overflow-auto whitespace-pre-wrap text-[10px] text-[#6b7b95]">
              {JSON.stringify(
                tools.find((t) => t.name === selected)?.inputSchema,
                null,
                2,
              )}
            </pre>
            <textarea
              className="field w-full font-mono"
              rows={5}
              aria-label="MCP tool arguments"
              value={argumentsJSON}
              onChange={(e) => setArgumentsJSON(e.target.value)}
            />
            <Button
              onClick={() => {
                try {
                  void rpc("mcp.call", {
                    name: selected,
                    arguments: JSON.parse(argumentsJSON),
                  })
                    .then((value) => setResult(JSON.stringify(value, null, 2)))
                    .catch(s.report);
                } catch (e) {
                  s.report(e);
                }
              }}
            >
              Run {selected}
            </Button>
          </>
        )}
        {result && (
          <pre className="overflow-auto whitespace-pre-wrap text-[10px] text-[#a1b0c7]">
            {result}
          </pre>
        )}
      </div>
    </>
  );
}
export function PreviewPanel() {
  const [input, setInput] = useState("http://localhost:5173");
  const [url, setURL] = useState("");
  const [nonce, setNonce] = useState(0);
  const report = useStudio((s) => s.report);
  return (
    <div className="flex h-full flex-col">
      <form
        className="flex shrink-0 items-center gap-2 border-b border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPreviewURL(input)) {
            report("Preview accepts only HTTP on localhost, 127.0.0.1 or ::1.");
            return;
          }
          setURL(input);
          setNonce((n) => n + 1);
        }}
      >
        <Globe size={13} className="ml-2 text-[#6c7b95]" />
        <input
          className="field min-w-0 flex-1"
          aria-label="Local preview URL"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button variant="outline" size="sm" type="submit">
          Open
        </Button>
      </form>
      {url ? (
        <webview
          key={nonce}
          className="flex-1"
          src={url}
          partition="degravity-preview"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-[#6b7a95]">
          Start your development server in the terminal, then open its local
          URL.
        </div>
      )}
    </div>
  );
}
