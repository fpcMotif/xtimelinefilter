import { TRUST_LINE, WELCOME_CTA, WELCOME_ROWS, WELCOME_SKIP, WELCOME_TITLE } from "@/core/strings";

export interface WelcomeCardProps {
  onTrySelectMode(): void;
  onSkip(): void;
}

/**
 * First-run welcome (story beat 3): X-anatomy dialog — #5b7083/40% backdrop,
 * 380px card — three gestures, one CTA, one trust fact. Under 60 seconds to
 * literacy; never re-shows once dismissed (restorable via Settings → Replay intro).
 */
export function WelcomeCard({ onTrySelectMode, onSkip }: WelcomeCardProps) {
  return (
    <div
      class="fixed inset-0 z-[2147483646] grid place-items-center"
      style={{ background: "rgba(91, 112, 131, 0.4)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={WELCOME_TITLE}
        class="bg-surface shadow-elevated w-[380px] max-w-[calc(100vw-32px)] rounded-2xl p-6"
      >
        <h2 class="text-ink text-[20px] font-bold">{WELCOME_TITLE}</h2>
        <ul class="mt-4 flex flex-col gap-3">
          {WELCOME_ROWS.map((row) => (
            <li key={row} class="text-ink flex items-start gap-2 text-[15px]">
              <span aria-hidden="true" class="text-accent mt-0.5">
                ·
              </span>
              {row}
            </li>
          ))}
        </ul>
        <div class="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onTrySelectMode}
            class="bg-accent text-accent-ink hover:bg-accent/90 rounded-full px-4 py-2.5 text-[15px] font-bold transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            {WELCOME_CTA}
          </button>
          <button
            type="button"
            onClick={onSkip}
            class="text-muted hover:text-ink rounded-full px-4 py-1.5 text-sm"
          >
            {WELCOME_SKIP}
          </button>
        </div>
        <p class="text-muted mt-4 text-center text-[13px]">{TRUST_LINE}</p>
      </div>
    </div>
  );
}
