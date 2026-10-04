import { DiffEditor } from "@monaco-editor/react";
import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { useStudio } from "../store";
import { rpc } from "../lib/api";
import type { Plan } from "../shared/protocol";
import { language } from "../lib/utils";
import { Button } from "./ui/button";

export function DiffViewer() {
  const { plan, set, report, refresh, documents } = useStudio();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  if (!plan) return null;
  const change =
    plan.changes.find((c) => c.path === selected) ?? plan.changes[0];
  const perform = async (
    method: "agent.apply" | "agent.reject" | "agent.rollback",
    path?: string,
  ) => {
    const paths = path
      ? [path]
      : plan.changes.filter((c) => c.state === "pending").map((c) => c.path);
    if (
      method !== "agent.reject" &&
      documents.some(
        (d) =>
          d.content !== d.saved &&
          (path
            ? d.path === path
            : plan.changes.some((c) => c.path === d.path)),
      )
    ) {
      report(
        "Save or close unsaved files before applying or rolling back agent changes.",
      );
      return;
    }
    setBusy(true);
    try {
      const next = await rpc<Plan>(
        method,
        method === "agent.apply"
          ? { id: plan.id, paths }
          : { id: plan.id, ...(path ? { path } : {}) },
      );
      set({ plan: next });
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium">
          Review changes{" "}
          <span className="ml-2 text-[#6f7890]">
            {plan.changes.length} files
          </span>
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSideBySide(!sideBySide)}
          >
            {sideBySide ? "Inline" : "Side by side"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Close review"
            onClick={() => set({ review: false })}
          >
            <X size={14} />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {plan.changes.map((c) => (
          <button
            key={c.path}
            onClick={() => setSelected(c.path)}
            className={`rounded px-2 py-1 text-[11px] ${change?.path === c.path ? "bg-primary/10 text-primary" : "text-[#8e96aa]"}`}
          >
            {c.state === "applied" ? "✓ " : c.state === "rejected" ? "× " : ""}
            {c.path}
          </button>
        ))}
      </div>
      {change ? (
        <>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
            <p className="min-w-0 text-[#a3a9bb]">
              {change.reason}
              {change.line && (
                <span className="ml-2 text-[#626e89]">Line {change.line}</span>
              )}
            </p>
            <div className="flex shrink-0 gap-1">
              {change.state === "pending" ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy || plan.status !== "approved"}
                    onClick={() => void perform("agent.apply", change.path)}
                  >
                    <Check size={12} />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void perform("agent.reject", change.path)}
                  >
                    <X size={12} />
                    Reject
                  </Button>
                </>
              ) : change.state === "applied" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void perform("agent.rollback", change.path)}
                >
                  <RotateCcw size={12} />
                  Roll back
                </Button>
              ) : (
                <span className="text-[#7f8699]">
                  {change.state.replace("_", " ")}
                </span>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <DiffEditor
              height="100%"
              theme="degravity"
              original={change.original ?? ""}
              modified={change.content ?? ""}
              language={language(change.path)}
              options={{
                readOnly: true,
                originalEditable: false,
                renderSideBySide: sideBySide,
                fontSize: 12,
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
              }}
            />
          </div>
        </>
      ) : (
        <div className="p-8 text-sm text-[#8e96aa]">
          This plan contains no file changes.
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between border-t border-border p-3">
        <span className="text-[10px] text-[#7e869b]">
          {plan.status === "proposed"
            ? "Approve the plan in the agent panel to apply changes."
            : "Original content is retained for this session."}
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void perform("agent.reject")}
          >
            Reject all
          </Button>
          <Button
            disabled={
              busy ||
              plan.status !== "approved" ||
              !plan.changes.some((c) => c.state === "pending")
            }
            onClick={() => void perform("agent.apply")}
          >
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
