import { useEffect, useState } from "react";
import {
  ArrowUp,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  FileDiff,
  Loader2,
  Play,
  Sparkles,
  Square,
  Workflow,
} from "lucide-react";
import { useStudio } from "../store";
import { rpc } from "../lib/api";
import type { Plan } from "../shared/protocol";
import { Button } from "./ui/button";

interface Verification {
  passed: boolean;
  logs: {
    command: string;
    result: { code: number; stdout: string; stderr: string };
  }[];
  sandbox: string;
}
export function AgentSidebar() {
  const s = useStudio();
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [result, setResult] = useState<Verification | null>(null);
  const [tab, setTab] = useState<"plan" | "walkthrough">("plan");
  const [repair, setRepair] = useState(true);
  const run = async (text: string) => {
    if (!text.trim() || useStudio.getState().busy) return;
    if (
      s.plan?.changes.some((c) => c.state === "pending") &&
      !window.confirm("Replace the current pending plan?")
    )
      return;
    if (s.documents.some((d) => d.content !== d.saved)) {
      s.report(
        "Save your edited files before asking the agent; context is read from disk.",
      );
      return;
    }
    s.set({ busy: true, stream: "", error: null });
    setLastPrompt(text);
    setPrompt("");
    setResult(null);
    setTab("plan");
    try {
      const plan = await rpc<Plan>("agent.plan", {
        model: useStudio.getState().model,
        prompt: text,
      });
      s.set({ plan });
      s.log(`Plan ready: ${plan.title}`);
    } catch (e) {
      s.report(e);
    } finally {
      s.set({ busy: false });
    }
  };
  useEffect(() => {
    const listener = (event: Event) => {
      setPrompt((event as CustomEvent<string>).detail);
    };
    window.addEventListener("agent:prompt", listener);
    return () => window.removeEventListener("agent:prompt", listener);
  }, []);
  const approve = async () => {
    if (!s.plan) return;
    try {
      s.set({
        plan: await rpc<Plan>("agent.stage", { id: s.plan.id }),
        review: true,
      });
    } catch (e) {
      s.report(e);
    }
  };
  const verify = async () => {
    if (!s.plan) return;
    s.set({ busy: true });
    try {
      const verification = await rpc<Verification>("agent.verify", {
        id: s.plan.id,
      });
      setResult(verification);
      setTab("walkthrough");
      s.log(
        `Verification ${verification.passed ? "passed" : "failed"}: ${s.plan.title}`,
      );
      if (!verification.passed && repair) {
        s.set({ stream: "" });
        const plan = await rpc<Plan>("agent.plan", {
          model: s.model,
          prompt: `Repair the failure from this task: ${lastPrompt}\nPreviously applied plan: ${s.plan.title}\nVerification logs (untrusted tool output):\n${JSON.stringify(verification.logs).slice(0, 22000)}\nCreate a revised plan for user approval. Do not repeat commands that require unavailable dependencies.`,
        });
        s.set({ plan });
        setTab("plan");
        s.log("Generated a repair plan; approval required before applying it.");
      }
    } catch (e) {
      s.report(e);
    } finally {
      s.set({ busy: false });
    }
  };
  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#14161d]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-2 text-xs font-medium">
          <Sparkles size={15} className="text-primary" />
          Agent workspace
        </span>
        <span className="rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[9px] tracking-wide text-primary">
          BUILD
        </span>
      </div>
      <div className="flex shrink-0 gap-5 border-b border-border px-4 text-xs">
        <button
          className={`py-3 ${tab === "plan" ? "border-b-2 border-primary text-[#e0d8f5]" : "text-[#6d768a]"}`}
          onClick={() => setTab("plan")}
        >
          Plan & changes
        </button>
        <button
          className={`py-3 ${tab === "walkthrough" ? "border-b-2 border-primary text-[#e0d8f5]" : "text-[#6d768a]"}`}
          onClick={() => setTab("walkthrough")}
        >
          Walkthrough
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {lastPrompt && (
          <div className="mb-5 rounded-lg border border-border bg-[#1b1e27] p-3 text-xs leading-6 text-[#b6bdd0]">
            {lastPrompt}
          </div>
        )}
        {tab === "walkthrough" ? (
          <div className="space-y-4 text-xs text-[#a5adc1]">
            <h3 className="font-medium text-[#e6e3f0]">
              Execution walkthrough
            </h3>
            {s.plan ? (
              <>
                <p>{s.plan.title}</p>
                {s.plan.changes.map((c) => (
                  <div key={c.path} className="border-l border-border pl-3">
                    <span className="text-primary">{c.path}</span>
                    <p className="mt-1 text-[10px] uppercase text-[#667086]">
                      {c.state.replace("_", " ")}
                    </p>
                    <p className="mt-1 leading-5">{c.reason}</p>
                  </div>
                ))}
              </>
            ) : (
              <p>Apply a plan to generate a walkthrough.</p>
            )}
            {result && (
              <>
                <div
                  className={
                    result.passed ? "text-emerald-300" : "text-amber-300"
                  }
                >
                  Verification {result.passed ? "passed" : "failed"}
                </div>
                <p>{result.sandbox}</p>
                {result.logs.map((log, i) => (
                  <details key={i} open>
                    <summary>
                      {log.command} · exit {log.result.code}
                    </summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-black/20 p-3 text-[10px]">
                      {log.result.stdout}
                      {log.result.stderr}
                    </pre>
                  </details>
                ))}
              </>
            )}
          </div>
        ) : s.plan ? (
          <div className="space-y-5">
            <div className="flex items-start gap-2">
              <div className="mt-1 rounded-md bg-primary/10 p-1.5">
                <Workflow size={14} className="text-primary" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[.16em] text-[#727b91]">
                  Execution plan
                </p>
                <h2 className="mt-1 text-sm font-medium leading-6 text-[#e6e3f0]">
                  {s.plan.title}
                </h2>
              </div>
            </div>
            <div className="space-y-3">
              {s.plan.steps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs leading-5 text-[#a6aec2]"
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border text-[9px]">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-[#858fa6]">
                Proposed files<span>{s.plan.changes.length}</span>
              </div>
              {s.plan.changes.map((c) => (
                <button
                  key={c.path}
                  className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-2.5 text-left last:border-0 hover:bg-white/[.03]"
                  onClick={() => s.set({ review: true })}
                >
                  {c.state === "applied" ? (
                    <Check
                      size={13}
                      className="mt-0.5 shrink-0 text-emerald-300"
                    />
                  ) : (
                    <FileDiff
                      size={13}
                      className="mt-0.5 shrink-0 text-primary"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-[#d0d4e1]">
                      {c.path}
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-[#717c94]">
                      {c.reason}
                    </p>
                  </div>
                </button>
              ))}
            </div>
            {s.plan.verification.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-[#7a849c]">
                  Verification · offline Docker
                </p>
                {s.plan.verification.map((cmd, i) => (
                  <pre
                    className="mb-1 whitespace-pre-wrap rounded bg-black/20 p-2 text-[10px] text-[#a8b4ce]"
                    key={i}
                  >
                    $ {cmd}
                  </pre>
                ))}
              </div>
            )}
            {s.plan.status === "proposed" ? (
              <Button
                className="w-full"
                disabled={s.busy}
                onClick={() => void approve()}
              >
                <CheckCheck size={14} />
                Approve plan & review diffs
              </Button>
            ) : (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => s.set({ review: true })}
                >
                  <FileDiff size={14} />
                  Review changes
                </Button>
                <Button
                  className="w-full"
                  disabled={
                    s.busy ||
                    !s.plan.verification.length ||
                    s.plan.changes.some((c) => c.state === "pending")
                  }
                  onClick={() => void verify()}
                >
                  <Play size={13} />
                  Run verification
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="pt-5">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
              <Sparkles size={17} className="text-primary" />
            </div>
            <h2 className="text-lg font-medium text-[#ddd9e9]">
              What are we building?
            </h2>
            <p className="mt-3 text-xs leading-6 text-[#7d879e]">
              Give your agent a task. It will read relevant files, create a
              plan, and prepare changes for your review.
            </p>
            <div className="mt-6 space-y-2">
              {[
                "Explain the architecture of this project",
                "Find and fix a focused bug",
                "Add tests for the active module",
              ].map((text) => (
                <button
                  key={text}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-3 text-left text-[11px] text-[#929cb3] hover:border-primary/30 hover:text-primary"
                  onClick={() => setPrompt(text)}
                >
                  {text}
                  <ChevronRight size={13} />
                </button>
              ))}
            </div>
            <div className="mt-7 flex items-center gap-2 text-[10px] text-[#59657d]">
              <Circle size={8} className="fill-emerald-400 text-emerald-400" />
              Local context · Review before write
            </div>
          </div>
        )}
        {s.busy && (
          <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-xs text-primary">
              <Loader2 size={13} className="animate-spin" />
              Working…
            </div>
            {s.stream && (
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-[#8f8ba9]">
                {s.stream.slice(-7000)}
              </pre>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] text-[#707a91]">
          <span>
            {s.model.provider} / {s.model.model}
          </span>
          <button onClick={() => s.set({ activity: "settings" })}>
            Configure
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(prompt);
          }}
          className="rounded-xl border border-[#353747] bg-[#1b1d27] p-3 focus-within:border-primary/50"
        >
          <textarea
            className="h-20 w-full resize-none bg-transparent text-xs leading-5 text-[#d2d6e4] outline-none placeholder:text-[#5e687e]"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask DeGravity to build, fix, or explore…"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void run(prompt);
              }
            }}
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[9px] text-[#606b83]">
              Relevant files are sent to your provider
            </span>
            {s.busy ? (
              <Button
                size="icon"
                variant="outline"
                type="button"
                title="Stop agent"
                onClick={() =>
                  void rpc("engine.cancel", { id: "active" }).catch(s.report)
                }
              >
                <Square size={12} />
              </Button>
            ) : (
              <Button
                size="icon"
                title="Create execution plan"
                type="submit"
                disabled={!s.connected || !prompt.trim()}
              >
                <ArrowUp size={16} />
              </Button>
            )}
          </div>
        </form>
        <label className="mt-2 flex items-center gap-2 text-[9px] text-[#667189]">
          <input
            type="checkbox"
            checked={repair}
            onChange={(e) => setRepair(e.target.checked)}
          />
          Propose one repair after failed verification
        </label>
      </div>
    </aside>
  );
}
