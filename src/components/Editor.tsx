import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Code2,
  Command,
  FolderOpen,
  PanelLeftClose,
  Save,
  Sparkles,
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
} from "lucide-react";
import { useStudio } from "../store";
import { language, fileURI } from "../lib/utils";
import { Button } from "./ui/button";
import { attachDocument } from "../lib/lsp";

export function Editor() {
  const s = useStudio();
  const [prompt, setPrompt] = useState("");
  const [selection, setSelection] = useState("");
  const dispose = useRef<(() => void) | undefined>();
  const doc = s.documents.find((d) => d.path === s.active);
  const second = s.documents.find((d) => d.path !== s.active) ?? doc;
  useEffect(() => () => dispose.current?.(), []);
  const mounted: OnMount = (editor, monaco) => {
    editor.addAction({
      id: "degravity.inline",
      label: "Ask DeGravity",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => {
        setSelection(
          editor.getModel()?.getValueInRange(editor.getSelection()!) ?? "",
        );
        s.set({ inline: true });
      },
    });
    editor.addAction({
      id: "degravity.save",
      label: "Save file",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => useStudio.getState().save(),
    });
    dispose.current?.();
    dispose.current = attachDocument(editor, monaco);
  };
  const pane = (document: NonNullable<typeof doc>, secondary = false) => (
    <div
      className="min-h-0 min-w-0 flex-1"
      key={`${secondary ? "second" : "main"}-${document.path}-${s.lsp}`}
    >
      <MonacoEditor
        height="100%"
        theme="degravity"
        path={
          fileURI(s.root ?? "", document.path) + (secondary ? "?split" : "")
        }
        language={language(document.path)}
        value={document.content}
        onChange={(value) => s.edit(document.path, value ?? "")}
        onMount={secondary ? undefined : mounted}
        options={{
          fontSize: 13,
          fontFamily: "Cascadia Code, Consolas, monospace",
          lineHeight: 22,
          minimap: { enabled: false },
          padding: { top: 16 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          renderLineHighlight: "all",
          bracketPairColorization: { enabled: true },
          automaticLayout: true,
          tabSize: 2,
        }}
      />
    </div>
  );
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-[#13151b]">
        <div className="flex h-full flex-1 overflow-x-auto">
          {s.documents.map((d) => (
            <div
              key={d.path}
              className={`flex shrink-0 items-center gap-2 border-r border-border px-3 text-xs ${s.active === d.path ? "border-t-2 border-t-primary bg-[#171920] text-white" : "text-[#7f8599]"}`}
            >
              <button
                className="flex items-center gap-2"
                onClick={() => s.set({ active: d.path })}
              >
                <Code2 size={13} className="text-[#9bb0d9]" />
                {d.path.split("/").pop()}
                {d.content !== d.saved && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
              <button title="Close file" onClick={() => s.close(d.path)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <Button
          title="Save file"
          variant="ghost"
          size="icon"
          onClick={() => void s.save()}
        >
          <Save size={14} />
        </Button>
        <Button
          title="Split side by side"
          variant="ghost"
          size="icon"
          onClick={() =>
            s.set({ split: s.split === "horizontal" ? "none" : "horizontal" })
          }
        >
          <SplitSquareHorizontal size={14} />
        </Button>
        <Button
          title="Split stacked"
          variant="ghost"
          size="icon"
          onClick={() =>
            s.set({ split: s.split === "vertical" ? "none" : "vertical" })
          }
        >
          <SplitSquareVertical size={14} />
        </Button>
      </div>
      {doc ? (
        <>
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/50 px-4 text-[11px] text-[#7d8499]">
            {doc.path.replaceAll("/", "  /  ")}
            {doc.conflict && (
              <span className="text-amber-300">
                Changed on disk · save blocked until reconciled
              </span>
            )}
          </div>
          <div
            className={`flex min-h-0 flex-1 ${s.split === "vertical" ? "flex-col" : ""}`}
          >
            {pane(doc)}
            {s.split !== "none" && second && (
              <>
                <div
                  className={
                    s.split === "vertical" ? "h-px bg-border" : "w-px bg-border"
                  }
                />
                {pane(second, true)}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="welcome flex flex-1 flex-col items-center justify-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/5">
            <Sparkles className="text-primary" size={28} />
          </div>
          <h1 className="text-3xl font-medium tracking-tight text-[#e9e6f4]">
            Space to build.
          </h1>
          <p className="mb-8 mt-3 text-sm text-[#7e8498]">
            Your code. Your models. A little less gravity.
          </p>
          <Button variant="outline" onClick={() => void s.openWorkspace()}>
            <FolderOpen size={14} />
            Open a workspace
          </Button>
          <div className="mt-10 space-y-3 text-xs text-[#6b7287]">
            <div className="flex w-60 justify-between">
              <span>Find a file</span>
              <kbd>Ctrl / ⌘ P</kbd>
            </div>
            <div className="flex justify-between">
              <span>Ask your agent</span>
              <kbd>Ctrl / ⌘ K</kbd>
            </div>
            <div className="flex justify-between">
              <span>Save changes</span>
              <kbd>Ctrl / ⌘ S</kbd>
            </div>
          </div>
          <div className="mt-12 flex items-center gap-2 text-[10px] uppercase tracking-[.25em] text-[#535b72]">
            <Command size={12} />
            Built for flow
          </div>
        </div>
      )}
      {s.inline && (
        <div className="absolute left-1/2 top-24 z-20 w-[min(540px,90%)] -translate-x-1/2 rounded-xl border border-primary/40 bg-[#20212c] p-3 shadow-2xl">
          <div className="mb-2 flex items-center gap-2 text-xs text-primary">
            <Sparkles size={14} />
            Ask DeGravity{" "}
            {doc && (
              <span className="truncate text-[#8e91a4]">· {doc.path}</span>
            )}
            <button
              className="ml-auto"
              onClick={() => s.set({ inline: false })}
            >
              <X size={14} />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              window.dispatchEvent(
                new CustomEvent("agent:prompt", {
                  detail: `${prompt}\nActive file: ${doc?.path ?? "none"}${selection ? "\nSelected code:\n" + selection : ""}`,
                }),
              );
              s.set({ inline: false });
              setPrompt("");
            }}
          >
            <textarea
              autoFocus
              rows={3}
              className="w-full resize-none bg-transparent text-sm outline-none"
              placeholder="Explain, refactor, or build something…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex justify-between">
              <span className="text-[10px] text-[#71788c]">
                Changes always start with a plan
              </span>
              <Button size="sm" disabled={!prompt.trim()} type="submit">
                <ArrowUp size={14} />
                Send
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
