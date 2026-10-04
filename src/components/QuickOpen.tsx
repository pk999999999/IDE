import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { FileCode2, Search } from "lucide-react";
import { useStudio } from "../store";
export function QuickOpen({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const files = useStudio((s) => s.files);
  const openFile = useStudio((s) => s.open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[18%] z-50 w-[620px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-[#191b23] shadow-2xl">
          <Dialog.Title className="sr-only">Open a file</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search workspace paths
          </Dialog.Description>
          <div className="flex items-center gap-3 border-b border-border p-4">
            <Search size={17} />
            <input
              autoFocus
              className="flex-1 bg-transparent outline-none"
              placeholder="Search files by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>esc</kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {files
              .filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 80)
              .map((f) => (
                <button
                  key={f.path}
                  className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm hover:bg-white/5"
                  onClick={() => {
                    void openFile(f.path);
                    onOpenChange(false);
                  }}
                >
                  <FileCode2 size={15} className="text-primary" />
                  {f.path}
                </button>
              ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
