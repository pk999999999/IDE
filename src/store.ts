import { create } from "zustand";
import { rpc, message } from "./lib/api";
import type { FileEntry, Model, Plan } from "./shared/protocol";

export interface Document {
  path: string;
  content: string;
  saved: string;
  conflict: boolean;
}
interface State {
  root: string | null;
  connected: boolean;
  files: FileEntry[];
  documents: Document[];
  active: string | null;
  activity: "files" | "search" | "git" | "mcp" | "settings";
  bottom: "terminal" | "output" | "problems" | "preview";
  split: "none" | "horizontal" | "vertical";
  plan: Plan | null;
  review: boolean;
  model: Model;
  busy: boolean;
  stream: string;
  logs: string[];
  error: string | null;
  inline: boolean;
  diagnostics: { path: string; line: number; message: string }[];
  lsp: boolean;
  set(patch: Partial<State>): void;
  report(error: unknown): void;
  log(text: string): void;
  openWorkspace(): Promise<void>;
  refresh(): Promise<void>;
  open(path: string): Promise<void>;
  edit(path: string, content: string): void;
  save(path?: string): Promise<void>;
  close(path: string): void;
}
export const useStudio = create<State>((set, get) => ({
  root: null,
  connected: false,
  files: [],
  documents: [],
  active: null,
  activity: "files",
  bottom: "terminal",
  split: "none",
  plan: null,
  review: false,
  model: { provider: "openai", model: "gpt-4.1" },
  busy: false,
  stream: "",
  logs: [],
  error: null,
  inline: false,
  diagnostics: [],
  lsp: false,
  set,
  report: (error) => {
    const text = message(error);
    set({ error: text });
    get().log(text);
  },
  log: (text) =>
    set((state) => ({
      logs: [
        ...state.logs,
        `[${new Date().toLocaleTimeString()}] ${text}`,
      ].slice(-300),
    })),
  openWorkspace: async () => {
    if (
      get().documents.some((d) => d.content !== d.saved) &&
      !window.confirm("Discard unsaved changes and open another workspace?")
    )
      return;
    if (get().busy) {
      get().report("Stop the running agent before switching workspaces.");
      return;
    }
    try {
      const result = await window.studio.openWorkspace();
      if (!result) return;
      set({
        root: result.root,
        connected: true,
        files: [],
        documents: [],
        active: null,
        plan: null,
        review: false,
        stream: "",
        lsp: false,
        diagnostics: [],
      });
      await get().refresh();
      get().log(`Connected to ${result.root}`);
    } catch (error) {
      set({ connected: false });
      get().report(error);
    }
  },
  refresh: async () => {
    if (!get().connected) return;
    try {
      const files = await rpc<FileEntry[]>("fs.list", {});
      set({ files });
      await Promise.all(
        get().documents.map(async (doc) => {
          try {
            const { content } = await rpc<{ content: string }>("fs.read", {
              path: doc.path,
            });
            set((state) => ({
              documents: state.documents.map((current) =>
                current.path !== doc.path
                  ? current
                  : current.content === current.saved
                    ? { ...current, content, saved: content, conflict: false }
                    : { ...current, conflict: content !== current.saved },
              ),
            }));
          } catch {
            set((state) => ({
              documents: state.documents.map((current) =>
                current.path === doc.path
                  ? { ...current, conflict: true }
                  : current,
              ),
            }));
          }
        }),
      );
    } catch (error) {
      get().report(error);
    }
  },
  open: async (path) => {
    if (get().documents.some((d) => d.path === path)) {
      set({ active: path, review: false });
      return;
    }
    try {
      const { content } = await rpc<{ content: string }>("fs.read", { path });
      set((state) => ({
        documents: state.documents.some((d) => d.path === path)
          ? state.documents
          : [
              ...state.documents,
              { path, content, saved: content, conflict: false },
            ],
        active: path,
        review: false,
      }));
    } catch (error) {
      get().report(error);
    }
  },
  edit: (path, content) =>
    set((state) => ({
      documents: state.documents.map((d) =>
        d.path === path ? { ...d, content } : d,
      ),
    })),
  save: async (path) => {
    const doc = get().documents.find((d) => d.path === (path ?? get().active));
    if (!doc) return;
    try {
      await rpc("fs.write", {
        path: doc.path,
        content: doc.content,
        expected: doc.saved,
      });
      set((state) => ({
        documents: state.documents.map((d) =>
          d.path === doc.path
            ? { ...d, saved: doc.content, conflict: false }
            : d,
        ),
      }));
    } catch (error) {
      get().report(error);
    }
  },
  close: (path) => {
    const doc = get().documents.find((d) => d.path === path);
    if (
      doc &&
      doc.content !== doc.saved &&
      !window.confirm(`Discard unsaved changes in ${path}?`)
    )
      return;
    set((state) => {
      const documents = state.documents.filter((d) => d.path !== path);
      return {
        documents,
        active:
          state.active === path
            ? (documents.at(-1)?.path ?? null)
            : state.active,
      };
    });
  },
}));
