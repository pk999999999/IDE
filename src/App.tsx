import { useEffect, useState } from "react";
import {
  AlertCircle,
  Blocks,
  Braces,
  Check,
  ChevronDown,
  Circle,
  Command,
  Files,
  GitBranch,
  Globe,
  Minus,
  PanelBottom,
  Search,
  Settings2,
  Sparkles,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { useStudio } from "./store";
import { Editor } from "./components/Editor";
import { AgentSidebar } from "./components/AgentSidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { DiffViewer } from "./components/DiffViewer";
import { FileTree } from "./components/FileTree";
import { QuickOpen } from "./components/QuickOpen";
import {
  MCPPanel,
  PreviewPanel,
  SearchPanel,
  SettingsPanel,
  SourceControl,
} from "./components/WorkspacePanels";
import { Button } from "./components/ui/button";

export default function App() {
  const s = useStudio();
  const [quickOpen, setQuickOpen] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(230);
  const [sideWidth, setSideWidth] = useState(230);
  const [agentWidth, setAgentWidth] = useState(355);
  const [bottomVisible, setBottomVisible] = useState(true);
  useEffect(() => {
    const action = (name: string) => {
      const state = useStudio.getState();
      if (name === "open") void state.openWorkspace();
      if (name === "save") void state.save();
      if (name === "quickOpen") setQuickOpen(true);
      if (name === "prompt") state.set({ inline: true });
      if (name === "terminal") {
        setBottomVisible(true);
        state.set({ bottom: "terminal" });
        setTimeout(
          () => window.dispatchEvent(new Event("terminal:focus")),
          100,
        );
      }
    };
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const commands: Record<string, string> = {
        p: "quickOpen",
        k: "prompt",
        o: "open",
        s: "save",
        "`": "terminal",
      };
      const command = commands[event.key.toLowerCase()];
      if (command) {
        event.preventDefault();
        action(command);
      }
    };
    window.addEventListener("keydown", keys);
    let refreshTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = window.studio?.subscribe((event) => {
      const state = useStudio.getState();
      if (event.event === "workspace.changed") {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void state.refresh(), 350);
      }
      if (event.event === "engine.error") {
        state.set({ connected: false });
        state.report((event.data as { message: string }).message);
      }
      if (event.event === "agent.delta")
        state.set({
          stream: (state.stream + (event.data as { text: string }).text).slice(
            -80000,
          ),
        });
      if (event.event === "agent.verification")
        state.log(JSON.stringify(event.data));
      if (event.event === "engine.log")
        state.log((event.data as { text: string }).text);
      if (event.event === "menu.action")
        action((event.data as { action: string }).action);
      if (event.event === "settings.saved")
        state.log("Settings saved. Reopen workspace to use new credentials.");
      if (event.event === "lsp.error") {
        state.set({ lsp: false });
        state.report((event.data as { message: string }).message);
      }
      if (event.event === "mcp.error")
        state.log((event.data as { message: string }).message);
    });
    return () => {
      window.removeEventListener("keydown", keys);
      unsubscribe?.();
      clearTimeout(refreshTimer);
    };
  }, []);
  const resize = (
    event: React.PointerEvent,
    axis: "bottom" | "side" | "agent",
  ) => {
    event.preventDefault();
    const startX = event.clientX,
      startY = event.clientY;
    const start =
      axis === "bottom"
        ? bottomHeight
        : axis === "side"
          ? sideWidth
          : agentWidth;
    const move = (e: PointerEvent) => {
      if (axis === "bottom")
        setBottomHeight(
          Math.max(
            140,
            Math.min(window.innerHeight - 250, start + startY - e.clientY),
          ),
        );
      if (axis === "side")
        setSideWidth(Math.max(190, Math.min(450, start + e.clientX - startX)));
      if (axis === "agent")
        setAgentWidth(Math.max(310, Math.min(650, start + startX - e.clientX)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const workspace =
    s.root?.replace(/\\/g, "/").split("/").pop() ?? "No workspace";
  const activities = [
    { id: "files", icon: Files, label: "Explorer" },
    { id: "search", icon: Search, label: "Search" },
    { id: "git", icon: GitBranch, label: "Source control" },
    { id: "mcp", icon: Blocks, label: "MCP servers" },
  ] as const;
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header
        className="titlebar flex h-11 shrink-0 items-center border-b border-border bg-[#111319]"
        style={{ paddingLeft: window.studio?.platform === "darwin" ? 72 : 0 }}
      >
        <div className="no-drag flex items-center gap-2 pl-4">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
            <Sparkles size={14} className="text-primary" />
          </div>
          <span className="text-xs font-semibold tracking-tight">
            DeGravity
            <span className="ml-1.5 font-normal text-[#67738b]">Studio</span>
          </span>
        </div>
        <nav className="no-drag ml-5 hidden items-center gap-4 text-[11px] text-[#7b869b] xl:flex">
          <button onClick={() => void s.openWorkspace()}>File</button>
          <button onClick={() => void s.save()}>Save</button>
          <button onClick={() => setQuickOpen(true)}>View</button>
          <button
            onClick={() => {
              setBottomVisible(true);
              s.set({ bottom: "terminal" });
            }}
          >
            Terminal
          </button>
          <button onClick={() => s.set({ inline: true })}>Agent</button>
          <button onClick={() => s.set({ activity: "settings" })}>
            Settings
          </button>
        </nav>
        <button
          className="no-drag mx-auto flex h-6 w-[min(30vw,400px)] items-center justify-center gap-2 rounded-md border border-border bg-white/[.02] text-[10px] text-[#818ba0]"
          onClick={() => setQuickOpen(true)}
        >
          <Search size={11} />
          {workspace}
          <kbd className="ml-auto mr-1">⌘ / Ctrl P</kbd>
        </button>
        <div className="no-drag flex items-center pr-2">
          <Button
            variant="ghost"
            size="icon"
            title="Toggle bottom panel"
            onClick={() => setBottomVisible(!bottomVisible)}
          >
            <PanelBottom size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Minimize"
            onClick={() => window.studio?.window("minimize")}
          >
            <Minus size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Maximize"
            onClick={() => window.studio?.window("maximize")}
          >
            <Square size={11} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Close"
            onClick={() => window.studio?.window("close")}
          >
            <X size={14} />
          </Button>
        </div>
      </header>
      {!window.studio && (
        <div className="bg-amber-500/10 px-5 py-2 text-xs text-amber-200">
          Browser preview · launch Electron with npm run dev to use the native
          engine.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-[#111319] py-3">
          {activities.map((a) => (
            <button
              key={a.id}
              title={a.label}
              aria-label={a.label}
              className={`relative flex h-10 w-full items-center justify-center ${s.activity === a.id ? "text-primary before:absolute before:left-0 before:h-5 before:w-0.5 before:rounded-r before:bg-primary" : "text-[#59637a] hover:text-[#b0b7c9]"}`}
              onClick={() => s.set({ activity: a.id })}
            >
              <a.icon size={20} strokeWidth={1.5} />
            </button>
          ))}
          <div className="flex-1" />
          <button
            className="mb-2 text-[#69768e] hover:text-primary"
            title="Settings"
            onClick={() => s.set({ activity: "settings" })}
          >
            <Settings2 size={20} />
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/25 bg-primary/5 text-[9px] text-primary">
            DG
          </div>
        </nav>
        <aside
          className="flex min-h-0 shrink-0 flex-col bg-[#14161d]"
          style={{ width: sideWidth }}
        >
          {s.activity === "files" ? (
            <FileTree />
          ) : s.activity === "search" ? (
            <SearchPanel />
          ) : s.activity === "git" ? (
            <SourceControl />
          ) : s.activity === "mcp" ? (
            <MCPPanel />
          ) : (
            <SettingsPanel />
          )}
        </aside>
        <div className="resize-x" onPointerDown={(e) => resize(e, "side")} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#171920]">
          <div className="min-h-0 flex-1">
            {s.review && s.plan ? <DiffViewer /> : <Editor />}
          </div>
          {bottomVisible && (
            <>
              <div
                className="resize-y"
                onPointerDown={(e) => resize(e, "bottom")}
              />
              <section
                className="flex shrink-0 flex-col bg-[#111319]"
                style={{ height: bottomHeight }}
              >
                <div className="flex h-9 shrink-0 items-center gap-5 border-b border-border px-4">
                  {(["terminal", "output", "problems", "preview"] as const).map(
                    (tab) => (
                      <button
                        key={tab}
                        className={`flex h-full items-center gap-1.5 text-[10px] ${s.bottom === tab ? "border-b border-primary text-[#ddd7ee]" : "text-[#68768e]"}`}
                        onClick={() => s.set({ bottom: tab })}
                      >
                        {tab === "terminal" && <TerminalSquare size={12} />}
                        <span className="capitalize">{tab}</span>
                        {tab === "problems" && s.diagnostics.length > 0 && (
                          <span className="text-primary">
                            {s.diagnostics.length}
                          </span>
                        )}
                      </button>
                    ),
                  )}
                  <button
                    className="ml-auto text-[#647089]"
                    title="Hide bottom panel"
                    onClick={() => setBottomVisible(false)}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="relative min-h-0 flex-1">
                  <div
                    className={`h-full ${s.bottom === "terminal" ? "" : "hidden"}`}
                  >
                    <TerminalPanel />
                  </div>
                  {s.bottom === "output" && (
                    <pre className="h-full overflow-auto whitespace-pre-wrap p-3 text-[10px] leading-5 text-[#8c9ab2]">
                      {s.logs.join("\n") ||
                        "Engine and agent logs appear here."}
                    </pre>
                  )}
                  {s.bottom === "problems" && (
                    <div className="h-full overflow-auto p-3 text-xs text-[#8c9ab2]">
                      {s.diagnostics.length ? (
                        s.diagnostics.map((d, i) => (
                          <button
                            key={i}
                            className="block py-1 text-left"
                            onClick={() => void s.open(d.path)}
                          >
                            {d.path}:{d.line} — {d.message}
                          </button>
                        ))
                      ) : (
                        <span>
                          No diagnostics. Connect a language server in Settings.
                        </span>
                      )}
                    </div>
                  )}
                  {s.bottom === "preview" && <PreviewPanel />}
                </div>
              </section>
            </>
          )}
        </main>
        <div className="resize-x" onPointerDown={(e) => resize(e, "agent")} />
        <div className="min-h-0 shrink-0" style={{ width: agentWidth }}>
          <AgentSidebar />
        </div>
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-[#111319] px-3 text-[10px] text-[#737f96]">
        <span className="flex items-center gap-1.5">
          <Circle
            size={6}
            className={
              s.connected
                ? "fill-emerald-400 text-emerald-400"
                : "fill-amber-400 text-amber-400"
            }
          />
          {s.connected ? "Engine connected" : "Engine offline"}
        </span>
        <span className="flex items-center gap-1">
          <Braces size={11} />
          Rust + Tokio
        </span>
        <span className="ml-auto">{s.active ?? "DeGravity Studio"}</span>
        <span>UTF-8</span>
        <span>{s.lsp ? "LSP connected" : "LSP offline"}</span>
        <Sparkles size={11} className="text-primary" />
      </footer>
      {s.error && (
        <div
          role="alert"
          className="fixed bottom-9 right-4 z-50 flex max-w-[560px] items-start gap-3 rounded-lg border border-red-400/30 bg-[#2b1d29] p-4 text-xs text-red-100 shadow-2xl"
        >
          <AlertCircle size={16} className="shrink-0" />
          <p className="break-words leading-5">{s.error}</p>
          <button
            title="Dismiss error"
            className="shrink-0"
            onClick={() => s.set({ error: null })}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <QuickOpen open={quickOpen} onOpenChange={setQuickOpen} />
    </div>
  );
}
