import { useRef } from "preact/hooks";

import { TRUST_LINE, WELCOME_CTA, WELCOME_ROWS, WELCOME_SKIP, WELCOME_TITLE } from "@/core/strings";
import { Button } from "@/ui/components";
import { useFocusTrap } from "@/ui/use-focus-trap";

export interface WelcomeCardProps {
  onTrySelectMode(): void;
  onSkip(): void;
}

/**
 * First-run welcome (story beat 3): scrim + 380px dialog — three gestures, one
 * CTA, one trust fact. Under 60 seconds to literacy; never re-shows once
 * dismissed (restorable via Settings → Replay intro). A true modal: focus is
 * trapped inside and returned on close.
 */
export function WelcomeCard({ onTrySelectMode, onSkip }: WelcomeCardProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  return (
    <div class="bg-scrim fixed inset-0 z-[2147483646] grid place-items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={WELCOME_TITLE}
        class="bg-card text-card-foreground shadow-elevated w-[380px] max-w-[calc(100vw-32px)] rounded-2xl p-6 transition-[opacity,transform] duration-300 ease-out starting:translate-y-2 starting:opacity-0"
      >
        <h2 class="text-[20px] font-bold">{WELCOME_TITLE}</h2>
        <ul class="mt-4 flex flex-col gap-3">
          {WELCOME_ROWS.map((row) => (
            <li key={row} class="text-md flex items-start gap-2">
              <span aria-hidden="true" class="text-primary mt-0.5">
                ·
              </span>
              {row}
            </li>
          ))}
        </ul>
        <div class="mt-5 flex flex-col gap-2">
          <Button size="lg" class="text-md w-full rounded-full font-bold" onClick={onTrySelectMode}>
            {WELCOME_CTA}
          </Button>
          <Button
            variant="ghost"
            class="text-muted-foreground w-full rounded-full"
            onClick={onSkip}
          >
            {WELCOME_SKIP}
          </Button>
        </div>
        <p class="text-muted-foreground text-compact mt-4 text-center">{TRUST_LINE}</p>
      </div>
    </div>
  );
}
