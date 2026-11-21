import * as stylex from "@stylexjs/stylex";
import { useRef } from "preact/hooks";

import { TRUST_LINE, WELCOME_CTA, WELCOME_ROWS, WELCOME_SKIP, WELCOME_TITLE } from "@/core/strings";
import { Button } from "@/ui/components";
import { UI_LAYER } from "@/ui/layers";
import { tokens } from "@/ui/tokens.stylex";
import { useFocusTrap } from "@/ui/use-focus-trap";

export interface WelcomeCardProps {
  onTrySelectMode(): void;
  onSkip(): void;
}

const styles = stylex.create({
  scrim: {
    backgroundColor: tokens.scrim,
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
  },
  dialog: {
    backgroundColor: tokens.card,
    color: tokens.cardForeground,
    boxShadow: tokens.shadowElevated,
    width: "380px",
    maxWidth: "calc(100vw - 32px)",
    borderRadius: tokens.radiusXl,
    padding: "1.5rem",
    boxSizing: "border-box",
  },
  title: {
    fontSize: tokens.textXl,
    fontWeight: "700",
    margin: 0,
  },
  list: {
    marginTop: "1rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    listStyleType: "none",
    padding: 0,
    margin: 0,
  },
  listItem: {
    fontSize: tokens.textMd,
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
  },
  bullet: {
    color: tokens.primary,
    marginTop: "0.125rem",
  },
  buttonGroup: {
    marginTop: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  ctaButton: {
    width: "100%",
    borderRadius: tokens.radiusFull,
    fontSize: tokens.textMd,
    fontWeight: "700",
  },
  skipButton: {
    width: "100%",
    borderRadius: tokens.radiusFull,
    color: tokens.mutedForeground,
  },
  trustLine: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    marginTop: "1rem",
    textAlign: "center",
  },
});

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
    <div {...stylex.props(styles.scrim)} style={{ zIndex: UI_LAYER.modal }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={WELCOME_TITLE}
        {...stylex.props(styles.dialog)}
      >
        <h2 {...stylex.props(styles.title)}>{WELCOME_TITLE}</h2>
        <ul {...stylex.props(styles.list)}>
          {WELCOME_ROWS.map((row) => (
            <li key={row} {...stylex.props(styles.listItem)}>
              <span aria-hidden="true" {...stylex.props(styles.bullet)}>
                ·
              </span>
              {row}
            </li>
          ))}
        </ul>
        <div {...stylex.props(styles.buttonGroup)}>
          <Button size="lg" sx={styles.ctaButton} onClick={onTrySelectMode}>
            {WELCOME_CTA}
          </Button>
          <Button variant="ghost" sx={styles.skipButton} onClick={onSkip}>
            {WELCOME_SKIP}
          </Button>
        </div>
        <p {...stylex.props(styles.trustLine)}>{TRUST_LINE}</p>
      </div>
    </div>
  );
}
