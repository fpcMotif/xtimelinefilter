import * as stylex from "@stylexjs/stylex";

import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  root: {
    position: "relative",
    display: "inline-flex",
    height: "22px",
    width: "38px",
    flexShrink: 0,
    boxSizing: "border-box",
  },
  input: {
    position: "absolute",
    inset: 0,
    zIndex: 10,
    margin: 0,
    cursor: "pointer",
    appearance: "none",
    borderRadius: tokens.radiusFull,
    outline: "none",
    ":focus-visible": {
      boxShadow: `0 0 0 1px var(--background), 0 0 0 3px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
  },
  track: {
    pointerEvents: "none",
    position: "absolute",
    inset: 0,
    borderRadius: tokens.radiusFull,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.secondary,
    transitionProperty: "background-color, border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
  },
  trackChecked: {
    borderColor: tokens.primary,
    backgroundColor: tokens.primary,
  },
  thumb: {
    pointerEvents: "none",
    position: "absolute",
    top: 3,
    left: 3,
    width: 16,
    height: 16,
    borderRadius: tokens.radiusFull,
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.1)",
    transitionProperty: "transform, background-color",
    transitionDuration: "200ms",
    transitionTimingFunction: tokens.easeOut,
  },
  thumbChecked: {
    transform: "translateX(16px)",
    backgroundColor: "#ffffff",
  },
});

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Omit when an enclosing <label>'s text already names it. */
  label?: string;
  /** id of the element that describes the control (aria-describedby). */
  describedBy?: string;
  id?: string;
  class?: string;
  className?: string;
  sx?: stylex.StyleXStyles;
}

/**
 * A tactile on/off toggle backed by a *real* `<input type="checkbox">` (styled,
 * not replaced) so the accessibility contracts hold: `getByLabelText(label)`
 * resolves to the input and `fireEvent.click` toggles it like a bare checkbox.
 */
export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  id,
  class: cls,
  className,
  sx,
}: SwitchProps) {
  const rootProps = stylex.props(styles.root, sx);
  const inputProps = stylex.props(styles.input);
  const trackProps = stylex.props(styles.track, checked && styles.trackChecked);
  const thumbProps = stylex.props(styles.thumb, checked && styles.thumbChecked);

  return (
    <span data-slot="switch" {...rootProps} class={cn(rootProps.className, cls, className)}>
      <input
        id={id}
        type="checkbox"
        {...(label ? { "aria-label": label } : {})}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        checked={checked}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        {...inputProps}
        class={inputProps.className}
      />
      <span aria-hidden="true" {...trackProps} class={trackProps.className} />
      <span aria-hidden="true" {...thumbProps} class={thumbProps.className} />
    </span>
  );
}
