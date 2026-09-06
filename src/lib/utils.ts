// oxlint-disable no-explicit-any
export type ClassValue = any;

/**
 * Zero-dependency class composer: joins class names, supports arrays and conditionals.
 */
export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === "string" || typeof input === "number") {
      classes.push(String(input));
    } else if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) classes.push(inner);
    } else if (typeof input === "object") {
      if ("value" in input) {
        const val = input.value;
        if (typeof val === "string") classes.push(val);
      } else {
        for (const [key, val] of Object.entries(input)) {
          if (val) classes.push(key);
        }
      }
    }
  }
  return classes.join(" ");
}
