import React from "react";
import ReactDOM from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import App from "./App";
import "./styles.css";

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label))
      return new HtmlWorker();
    if (["typescript", "javascript"].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};
monaco.editor.defineTheme("degravity", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "59677e", fontStyle: "italic" },
    { token: "keyword", foreground: "bd9bf1" },
    { token: "string", foreground: "acd4ac" },
    { token: "number", foreground: "dab98d" },
    { token: "type", foreground: "8dc8d0" },
  ],
  colors: {
    "editor.background": "#171920",
    "editor.foreground": "#c7cedd",
    "editorLineNumber.foreground": "#3f4b60",
    "editorLineNumber.activeForeground": "#8a95ad",
    "editor.lineHighlightBackground": "#1c1f29",
    "editor.selectionBackground": "#423759",
    "editorCursor.foreground": "#b5a0ff",
    "editorIndentGuide.background1": "#252b39",
    "editorWidget.background": "#202331",
    "editorWidget.border": "#343b4e",
  },
});
loader.config({ monaco });
class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="p-12 text-sm text-red-200">
        <h1 className="mb-4 text-xl">The interface encountered an error</h1>
        <pre className="whitespace-pre-wrap">{this.state.error}</pre>
        <button
          className="mt-6 rounded border p-3"
          onClick={() => location.reload()}
        >
          Reload interface
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
