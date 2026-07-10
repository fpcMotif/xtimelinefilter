import { signal } from "@preact/signals-core";
import { renderHook, act } from "@testing-library/preact";
import { expect, test, describe } from "vitest";

import { useSignalValue } from "@/ui/use-signal-value";

describe("useSignalValue", () => {
  test("returns the initial signal value", () => {
    const sig = signal("initial");
    const { result } = renderHook(() => useSignalValue(sig));
    expect(result.current).toBe("initial");
  });

  test("updates when the signal value changes", () => {
    const sig = signal(0);
    const { result } = renderHook(() => useSignalValue(sig));
    expect(result.current).toBe(0);

    act(() => {
      sig.value = 1;
    });
    expect(result.current).toBe(1);

    act(() => {
      sig.value = 42;
    });
    expect(result.current).toBe(42);
  });

  test("handles changing to a different signal", () => {
    const sig1 = signal("first");
    const sig2 = signal("second");

    const { result, rerender } = renderHook(({ sig }) => useSignalValue(sig), {
      initialProps: { sig: sig1 },
    });

    expect(result.current).toBe("first");

    rerender({ sig: sig2 });
    expect(result.current).toBe("second");

    act(() => {
      sig2.value = "second updated";
    });
    expect(result.current).toBe("second updated");

    act(() => {
      sig1.value = "first updated";
    });
    expect(result.current).toBe("second updated"); // Should still be listening to sig2
  });
});
