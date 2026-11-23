// Copy button that answers on the button itself (Glide: "You tapped copy. Did it work? Nobody should have to
// wonder."): the label turns into "Copied ✓" in green for 2 seconds, or "Couldn't copy" in red.
import { useState } from "react";

export default function CopyBtn({ text, T, className = "pc-pick", onCopied }: { text: string | null | undefined; T: (en: string, sw: string) => string; className?: string; onCopied?: () => void }) {
  const [st, setSt] = useState<"" | "done" | "fail">("");
  return (
    <button type="button" className={`${className} copy-btn ${st}`} disabled={!text} aria-live="polite" onClick={async () => {
      try { await navigator.clipboard.writeText(text ?? ""); setSt("done"); onCopied?.(); navigator.vibrate?.(10); }
      catch { setSt("fail"); }
      window.setTimeout(() => setSt(""), 2000);
    }}>{st === "done" ? T("Copied ✓", "Imenakiliwa ✓") : st === "fail" ? T("Couldn't copy", "Haikunakiliwa") : T("Copy", "Nakili")}</button>
  );
}
