import { type AssignSummary, summaryLine } from "@/core/result-summary";

export interface ToastProps {
  summary: AssignSummary;
}

/** Per-run result summary; enters via @starting-style (Tailwind `starting:`). */
export function Toast({ summary }: ToastProps) {
  return (
    <output
      aria-live="polite"
      class="bg-accent text-accent-ink shadow-elevated fixed bottom-20 left-1/2 z-[2147483646] -translate-x-1/2 rounded-full px-4 py-2.5 text-sm tabular-nums transition-[opacity,transform] duration-300 ease-out starting:translate-y-2 starting:opacity-0"
    >
      {summaryLine(summary)}
    </output>
  );
}
