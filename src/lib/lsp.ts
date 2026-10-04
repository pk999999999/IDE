import type * as Monaco from "monaco-editor";
import { rpc } from "./api";
import { fileURI } from "./utils";
import { useStudio } from "../store";

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
const range = (r: Range) => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
});
let providers: Monaco.IDisposable[] = [];
export async function startLsp(
  command: string,
  args: string[],
  monaco: typeof Monaco,
) {
  const root = useStudio.getState().root;
  if (!root) throw new Error("Open a workspace first.");
  await rpc("lsp.start", { command, args });
  try {
    await rpc("lsp.request", {
      method: "initialize",
      params: {
        processId: null,
        rootUri: fileURI(root),
        capabilities: {
          textDocument: {
            synchronization: { didSave: true },
            completion: { completionItem: { snippetSupport: false } },
            hover: { contentFormat: ["plaintext"] },
            publishDiagnostics: { relatedInformation: false },
          },
        },
        workspaceFolders: [
          { uri: fileURI(root), name: root.split(/[\\/]/).pop() },
        ],
      },
    });
    await rpc("lsp.notify", { method: "initialized", params: {} });
  } catch (error) {
    await rpc("lsp.stop", {});
    throw error;
  }
  for (const p of providers) p.dispose();
  providers = [];
  for (const lang of ["typescript", "javascript", "python", "rust"]) {
    providers.push(
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["."],
        provideCompletionItems: async (model, position) => {
          try {
            const result = await rpc<
              | {
                  items?: {
                    label: string;
                    kind?: number;
                    insertText?: string;
                    detail?: string;
                    textEdit?: { range: Range; newText: string };
                  }[];
                }
              | {
                  label: string;
                  kind?: number;
                  insertText?: string;
                  detail?: string;
                  textEdit?: { range: Range; newText: string };
                }[]
            >("lsp.request", {
              method: "textDocument/completion",
              params: {
                textDocument: { uri: model.uri.toString() },
                position: {
                  line: position.lineNumber - 1,
                  character: position.column - 1,
                },
              },
            });
            const word = model.getWordUntilPosition(position);
            const fallback = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };
            return {
              suggestions: (Array.isArray(result)
                ? result
                : (result?.items ?? [])
              )
                .slice(0, 200)
                .map((item) => ({
                  label: item.label,
                  kind: monaco.languages.CompletionItemKind.Text,
                  insertText:
                    item.textEdit?.newText ?? item.insertText ?? item.label,
                  detail: item.detail,
                  range: item.textEdit?.range
                    ? range(item.textEdit.range)
                    : fallback,
                })),
            };
          } catch {
            return { suggestions: [] };
          }
        },
      }),
    );
    providers.push(
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model, position) => {
          try {
            const result = await rpc<{
              contents:
                | string
                | { value: string }
                | (string | { value: string })[];
              range?: Range;
            } | null>("lsp.request", {
              method: "textDocument/hover",
              params: {
                textDocument: { uri: model.uri.toString() },
                position: {
                  line: position.lineNumber - 1,
                  character: position.column - 1,
                },
              },
            });
            if (!result) return null;
            const values = Array.isArray(result.contents)
              ? result.contents
              : [result.contents];
            return {
              contents: values.map((v) => ({
                value: typeof v === "string" ? v : v.value,
                isTrusted: false,
              })),
              range: result.range ? range(result.range) : undefined,
            };
          } catch {
            return null;
          }
        },
      }),
    );
  }
  useStudio.getState().set({ lsp: true });
}

export function attachDocument(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
) {
  const model = editor.getModel();
  if (!model || !useStudio.getState().lsp) return () => {};
  const uri = model.uri.toString();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = (
    method:
      | "textDocument/didOpen"
      | "textDocument/didChange"
      | "textDocument/didClose",
    params: Record<string, unknown>,
  ) =>
    void rpc("lsp.notify", { method, params }).catch(
      useStudio.getState().report,
    );
  notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: model.getLanguageId(),
      version: model.getVersionId(),
      text: model.getValue(),
    },
  });
  const changes = model.onDidChangeContent(() => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        notify("textDocument/didChange", {
          textDocument: { uri, version: model.getVersionId() },
          contentChanges: [{ text: model.getValue() }],
        }),
      180,
    );
  });
  const unsubscribe = window.studio.subscribe((event) => {
    if (event.event !== "lsp.notification") return;
    const data = event.data as {
      method: string;
      params: {
        uri: string;
        diagnostics: { range: Range; message: string; severity?: number }[];
      };
    };
    if (
      data.method !== "textDocument/publishDiagnostics" ||
      data.params.uri !== uri
    )
      return;
    monaco.editor.setModelMarkers(
      model,
      "lsp",
      data.params.diagnostics.map((d) => ({
        ...range(d.range),
        message: d.message,
        severity:
          d.severity === 1
            ? monaco.MarkerSeverity.Error
            : d.severity === 2
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
      })),
    );
    const path = useStudio.getState().active ?? uri;
    useStudio.setState((s) => ({
      diagnostics: [
        ...s.diagnostics.filter((d) => d.path !== path),
        ...data.params.diagnostics.map((d) => ({
          path,
          line: d.range.start.line + 1,
          message: d.message,
        })),
      ],
    }));
  });
  return () => {
    clearTimeout(timer);
    changes.dispose();
    unsubscribe();
    notify("textDocument/didClose", { textDocument: { uri } });
  };
}
