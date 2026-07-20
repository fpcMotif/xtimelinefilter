import { type ReadonlySignal, signal } from "@preact/signals-core";
import { act, render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { useSignalValue } from "@/ui/use-signal-value";

function TestComponent({ sig }: { sig: ReadonlySignal<number> }) {
  const value = useSignalValue(sig);
  return <div data-testid="value">{value}</div>;
}

describe("useSignalValue", () => {
  it("returns the initial value of the signal", () => {
    const count = signal(0);
    const { getByTestId } = render(<TestComponent sig={count} />);
    expect(getByTestId("value").textContent).toBe("0");
  });

  it("updates when the signal value changes", () => {
    const count = signal(0);
    const { getByTestId } = render(<TestComponent sig={count} />);

    act(() => {
      count.value = 1;
    });

    expect(getByTestId("value").textContent).toBe("1");
  });

  it("subscribes to a new signal if the signal prop changes", () => {
    const count1 = signal(1);
    const count2 = signal(2);

    const { getByTestId, rerender } = render(<TestComponent sig={count1} />);
    expect(getByTestId("value").textContent).toBe("1");

    rerender(<TestComponent sig={count2} />);
    expect(getByTestId("value").textContent).toBe("2");

    act(() => {
      count2.value = 3;
    });
    expect(getByTestId("value").textContent).toBe("3");

    // changing old signal shouldn't affect the component
    act(() => {
      count1.value = 5;
    });
    expect(getByTestId("value").textContent).toBe("3");
  });

  it("unsubscribes when unmounted", () => {
    const count = signal(0);
    let renderCount = 0;

    function CountingComponent({ sig }: { sig: ReadonlySignal<number> }) {
      useSignalValue(sig);
      renderCount++;
      return null;
    }

    const { unmount } = render(<CountingComponent sig={count} />);
    expect(renderCount).toBe(1);

    act(() => {
      count.value = 1;
    });
    expect(renderCount).toBe(2);

    unmount();

    act(() => {
      count.value = 2;
    });
    // Should not render again after unmount
    expect(renderCount).toBe(2);
  });
});
