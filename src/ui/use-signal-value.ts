import type { ReadonlySignal } from "@preact/signals-core";
import { useEffect, useState } from "preact/hooks";

/**
 * Bridges a framework-agnostic @preact/signals-core signal into Preact rendering
 * without requiring the signals babel transform (so it works under vitest too).
 */
export function useSignalValue<T>(sig: ReadonlySignal<T>): T {
  const [value, setValue] = useState<T>(sig.value);
  useEffect(() => sig.subscribe((v) => setValue(v)), [sig]);
  return value;
}
