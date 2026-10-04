import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export function language(path: string) {
  const ext = path.split(".").pop();
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        rs: "rust",
        py: "python",
        json: "json",
        md: "markdown",
        css: "css",
        html: "html",
        yml: "yaml",
        yaml: "yaml",
        toml: "ini",
        sh: "shell",
      } as Record<string, string>
    )[ext ?? ""] ?? "plaintext"
  );
}
export function fileURI(root: string, path = "") {
  const normalized =
    root
      .replace(/\\/g, "/")
      .replace(/^\/\/\?\//, "")
      .replace(/\/$/, "") + (path ? "/" + path : "");
  return (
    "file://" +
    (normalized.startsWith("/") ? "" : "/") +
    normalized
      .split("/")
      .map((part, index) =>
        index === 0 && /^[A-Za-z]:$/.test(part)
          ? part
          : encodeURIComponent(part),
      )
      .join("/")
  );
}
