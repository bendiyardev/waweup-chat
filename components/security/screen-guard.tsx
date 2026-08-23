"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";

/**
 * Best-effort screen-capture shield for the private room. Browsers cannot
 * truly block OS screenshots or screen recording — only a native app can —
 * but this covers the room content with an "encrypted screenshot" screen the
 * moment the window loses focus / is backgrounded (which is what a screen
 * recorder or an app-switch preview captures) and when the PrintScreen key is
 * pressed, and it neutralises printing/PDF export. It also discourages casual
 * copying by disabling selection, context menu and dragging on room content.
 */
export function ScreenGuard() {
  const { d } = useI18n();
  const [shielded, setShielded] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const shield = () => setShielded(true);
    const unshield = () => {
      // Only reveal again when the window is genuinely focused and visible.
      if (document.visibilityState === "visible" && document.hasFocus()) {
        setShielded(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") shield();
      else unshield();
    };

    const flashShield = () => {
      shield();
      if (timerRef.current) clearTimeout(timerRef.current);
      // Keep the shield up briefly, then reveal if we're back in focus.
      timerRef.current = setTimeout(unshield, 1200);
    };

    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      // PrintScreen (and Snip shortcuts we can observe) → shield + wipe clipboard.
      if (
        key === "PrintScreen" ||
        (e.shiftKey && (e.metaKey || e.ctrlKey) && (key === "S" || key === "s" || key === "3" || key === "4" || key === "5"))
      ) {
        flashShield();
        try {
          void navigator.clipboard?.writeText("");
        } catch {
          // clipboard may be unavailable — nothing else to do
        }
      }
    };

    window.addEventListener("blur", shield);
    window.addEventListener("focus", unshield);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);

    // Discourage casual capture/copy of room content.
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    document.addEventListener("dragstart", block);
    document.body.classList.add("wg-no-select");

    return () => {
      window.removeEventListener("blur", shield);
      window.removeEventListener("focus", unshield);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
      document.body.classList.remove("wg-no-select");
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <>
      {/* On-screen shield: covers the room whenever it is not actively viewed. */}
      <div
        aria-hidden={!shielded}
        className={`fixed inset-0 z-[999] flex flex-col items-center justify-center gap-4 bg-white text-neutral-900 transition-opacity duration-100 ${
          shielded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <span className="flex size-16 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50">
          <Lock className="size-8 text-neutral-500" aria-hidden />
        </span>
        <div className="px-6 text-center">
          <p className="text-lg font-semibold tracking-tight">{d.common.screenGuardTitle}</p>
          <p className="mt-1.5 text-sm text-neutral-500">{d.common.screenGuardHint}</p>
        </div>
      </div>

      {/* Print / PDF export shows only this warning, never the conversation. */}
      <div id="wg-print" className="hidden" aria-hidden>
        <Lock className="size-8" aria-hidden />
        <p>{d.common.screenGuardTitle}</p>
      </div>
    </>
  );
}
