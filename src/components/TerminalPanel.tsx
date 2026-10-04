import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { rpc } from "../lib/api";
import { useStudio } from "../store";

export function TerminalPanel() {
  const container = useRef<HTMLDivElement>(null);
  const root = useStudio((s) => s.root);
  const connected = useStudio((s) => s.connected);
  useEffect(() => {
    if (!container.current || !root || !connected) return;
    const terminal = new Terminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#111319",
        foreground: "#b5bcce",
        cursor: "#b5a0ff",
        selectionBackground: "#554477",
        black: "#171920",
        red: "#ed8699",
        green: "#9cceb3",
        yellow: "#e3c78f",
        blue: "#8ca8da",
        magenta: "#b5a0ff",
        cyan: "#90cdd3",
        white: "#e1e4ed",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    fit.fit();
    let id: string | undefined;
    let disposed = false;
    const early = new Map<string, string[]>();
    const unsubscribe = window.studio.subscribe((event) => {
      const data = event.data as { id: string; base64?: string };
      if (event.event === "pty.data" && data.base64) {
        if (!id) {
          const queue = early.get(data.id) ?? [];
          if (queue.length < 256) queue.push(data.base64);
          early.set(data.id, queue);
        } else if (data.id === id)
          terminal.write(
            Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0)),
          );
      }
      if (event.event === "pty.exit" && data.id === id)
        terminal.writeln(
          "\r\n\x1b[90m[Process exited. Reopen workspace to start a new terminal.]\x1b[0m",
        );
    });
    void rpc<{ id: string }>("pty.create", {
      cols: terminal.cols,
      rows: terminal.rows,
    })
      .then((result) => {
        id = result.id;
        if (disposed) {
          void rpc("pty.close", { id }).catch(() => {});
          return;
        }
        for (const chunk of early.get(id) ?? [])
          terminal.write(Uint8Array.from(atob(chunk), (c) => c.charCodeAt(0)));
        early.clear();
      })
      .catch(useStudio.getState().report);
    const input = terminal.onData((text) => {
      if (id)
        void rpc("pty.write", { id, text }).catch(useStudio.getState().report);
    });
    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed && container.current?.clientHeight) {
          fit.fit();
          if (id)
            void rpc("pty.resize", {
              id,
              cols: Math.min(500, terminal.cols),
              rows: Math.min(300, terminal.rows),
            }).catch(() => {});
        }
      }, 80);
    });
    observer.observe(container.current);
    const focus = () => terminal.focus();
    window.addEventListener("terminal:focus", focus);
    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      unsubscribe();
      input.dispose();
      window.removeEventListener("terminal:focus", focus);
      if (id) void rpc("pty.close", { id }).catch(() => {});
      terminal.dispose();
    };
  }, [root, connected]);
  return (
    <div className="h-full p-3" ref={container}>
      {!root && (
        <span className="text-xs text-[#697187]">
          Open a workspace to start a native terminal.
        </span>
      )}
    </div>
  );
}
