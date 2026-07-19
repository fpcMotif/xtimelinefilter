import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { UI_LAYER } from "@/ui/layers";
import { WelcomeCard } from "@/ui/WelcomeCard";

describe("WelcomeCard — three gestures, one CTA, one trust fact (story beat 3)", () => {
  it("renders the title, gesture rows, and the trust footer", () => {
    const { getByText, getByRole } = render(
      <WelcomeCard onTrySelectMode={() => {}} onSkip={() => {}} />,
    );
    expect(getByRole("dialog")).toBeTruthy();
    expect(getByText("Lasso is ready")).toBeTruthy();
    expect(getByText("Hover any post and press Alt+L to file its author into a List")).toBeTruthy();
    expect(getByText("Press s to select many people, then add them all at once")).toBeTruthy();
    expect(getByText("Press ? anytime to see every shortcut")).toBeTruthy();
    expect(
      getByText(
        "Lasso never sends your X session credentials to the Mirror. Mirror sync is off until you configure it.",
      ),
    ).toBeTruthy();
  });

  it("owns the modal layer", () => {
    const { getByRole } = render(<WelcomeCard onTrySelectMode={() => {}} onSkip={() => {}} />);
    const backdrop = getByRole("dialog").parentElement as HTMLElement;
    expect(Number(backdrop.style.zIndex)).toBe(UI_LAYER.modal);
  });

  it("wires the CTA and Skip", () => {
    const onTry = vi.fn();
    const onSkip = vi.fn();
    const { getByText } = render(<WelcomeCard onTrySelectMode={onTry} onSkip={onSkip} />);
    fireEvent.click(getByText("Try select mode"));
    fireEvent.click(getByText("Skip"));
    expect(onTry).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
