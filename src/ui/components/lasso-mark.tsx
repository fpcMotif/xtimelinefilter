/** The Lasso mark — a rope loop with a trailing lariat tail. Inherits currentColor. */
export function LassoMark({ size = 24, class: cls }: { size?: number; class?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      class={cls}
      aria-hidden="true"
      role="img"
    >
      <ellipse
        cx="11"
        cy="9.3"
        rx="8"
        ry="6.2"
        stroke="currentColor"
        stroke-width="2.1"
        opacity="0.95"
      />
      <path
        d="M16.4 14.4 L19 20.6"
        stroke="currentColor"
        stroke-width="2.1"
        stroke-linecap="round"
      />
      <circle cx="19.1" cy="21.2" r="1.5" fill="currentColor" />
    </svg>
  );
}
