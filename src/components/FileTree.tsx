import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
} from "lucide-react";
import { useStudio } from "../store";
import { rpc } from "../lib/api";
import { Button } from "./ui/button";
interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  file: boolean;
}
export function FileTree() {
  const { files, root, active, open, refresh, report, documents, close } =
    useStudio();
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [filePrompt, setFilePrompt] = useState<{ from: string } | null>(null);
  const [inputPath, setInputPath] = useState("");
  const tree = useMemo(() => {
    const tree: Node = { name: "", path: "", children: new Map(), file: false };
    for (const file of files) {
      let node = tree;
      const parts = file.path.split("/");
      parts.forEach((name, i) => {
        const path = parts.slice(0, i + 1).join("/");
        if (!node.children.has(name))
          node.children.set(name, {
            name,
            path,
            children: new Map(),
            file: i === parts.length - 1,
          });
        node = node.children.get(name)!;
      });
    }
    return tree;
  }, [files]);
  const mutate = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      report(e);
    }
  };
  const render = (node: Node, depth = 0): React.ReactNode =>
    [...node.children.values()]
      .sort(
        (a, b) =>
          Number(a.file) - Number(b.file) || a.name.localeCompare(b.name),
      )
      .map((child) => {
        const closed = collapsed.has(child.path);
        return (
          <div key={child.path}>
            <div
              className={`group flex h-7 items-center gap-1 pr-1 text-xs ${active === child.path ? "bg-primary/10 text-primary" : "text-[#a4a8b8] hover:bg-white/5"}`}
              style={{ paddingLeft: 10 + depth * 13 }}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title={child.path}
                onClick={() => {
                  if (child.file) void open(child.path);
                  else
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(child.path)) next.delete(child.path);
                      else next.add(child.path);
                      return next;
                    });
                }}
              >
                {child.file ? (
                  <FileCode2
                    size={14}
                    className="ml-3 shrink-0 text-[#8298bb]"
                  />
                ) : (
                  <>
                    <span>
                      {closed ? (
                        <ChevronRight size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </span>
                    {closed ? <Folder size={14} /> : <FolderOpen size={14} />}
                  </>
                )}
                <span className="truncate">{child.name}</span>
              </button>
              {child.file && (
                <div className="hidden group-hover:flex">
                  <button
                    title="Rename file"
                    className="p-1"
                    onClick={() => {
                      setInputPath(child.path);
                      setFilePrompt({ from: child.path });
                    }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    title="Delete file"
                    className="p-1 text-red-300"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${child.path}? This cannot be undone.`,
                        )
                      )
                        void mutate(async () => {
                          if (
                            documents.some(
                              (d) =>
                                d.path === child.path && d.content !== d.saved,
                            )
                          )
                            throw new Error(
                              "Save or close this file before deleting.",
                            );
                          await rpc("fs.delete", { path: child.path });
                          close(child.path);
                        });
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
            {!child.file && !closed && render(child, depth + 1)}
          </div>
        );
      });
  return (
    <>
      <div className="panel-heading">
        <span>EXPLORER</span>
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            title="New file"
            disabled={!root}
            onClick={() => {
              setInputPath("");
              setFilePrompt({ from: "" });
            }}
          >
            <Plus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Refresh files"
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>
      {root ? (
        <>
          <div className="px-3 py-3 text-[10px] font-semibold tracking-widest text-[#d4d7df]">
            {root.replace(/\\/g, "/").split("/").pop()?.toUpperCase()}
          </div>
          <div className="overflow-y-auto pb-5">{render(tree)}</div>
          <div className="mt-auto border-t border-border px-3 py-2 text-[10px] text-[#666d80]">
            {files.length.toLocaleString()} files · gitignore respected
          </div>
        </>
      ) : (
        <div className="p-5 text-xs leading-6 text-[#858b9e]">
          Open a folder to explore your project.
          <Button
            className="mt-4 w-full"
            variant="outline"
            onClick={() => void useStudio.getState().openWorkspace()}
          >
            Open folder
          </Button>
        </div>
      )}
      <Dialog.Root
        open={filePrompt !== null}
        onOpenChange={(open) => {
          if (!open) setFilePrompt(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/3 z-50 w-[440px] -translate-x-1/2 rounded-xl border border-border bg-[#191b23] p-5 shadow-2xl">
            <Dialog.Title className="mb-2 text-sm font-medium">
              {filePrompt?.from ? "Rename file" : "Create file"}
            </Dialog.Title>
            <Dialog.Description className="mb-4 text-xs text-[#8190a8]">
              Enter a path relative to the workspace, using forward slashes.
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const from = filePrompt?.from;
                const path = inputPath.trim();
                if (!path) return;
                setFilePrompt(null);
                void mutate(async () => {
                  if (from) {
                    if (
                      documents.some(
                        (d) => d.path === from && d.content !== d.saved,
                      )
                    )
                      throw new Error("Save this file before renaming.");
                    if (from !== path) {
                      await rpc("fs.rename", { from, to: path });
                      close(from);
                    }
                  } else
                    await rpc("fs.write", {
                      path,
                      content: "",
                      expected: null,
                    });
                  await open(path);
                });
              }}
            >
              <input
                autoFocus
                aria-label="Relative file path"
                className="field w-full"
                value={inputPath}
                onChange={(event) => setInputPath(event.target.value)}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setFilePrompt(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!inputPath.trim()}>
                  Save
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
