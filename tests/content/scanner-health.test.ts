import { describe, expect, it, vi } from "vitest";

import { createScannerHealth } from "@/content/scanner-health";

describe("createScannerHealth — selector breakage is a known state (story beat 8)", () => {
  it("fires once after >200 mutations with zero post matches", () => {
    const onBreakage = vi.fn();
    const health = createScannerHealth({ onBreakage });
    health.record(200, 0);
    expect(onBreakage).not.toHaveBeenCalled();
    health.record(1, 0);
    expect(onBreakage).toHaveBeenCalledTimes(1);
    health.record(500, 0); // never re-fires in the same session
    expect(onBreakage).toHaveBeenCalledTimes(1);
  });

  it("never fires once any post has matched", () => {
    const onBreakage = vi.fn();
    const health = createScannerHealth({ onBreakage });
    health.record(10, 1);
    health.record(500, 0);
    expect(onBreakage).not.toHaveBeenCalled();
  });

  it("accumulates across small batches", () => {
    const onBreakage = vi.fn();
    const health = createScannerHealth({ onBreakage });
    for (let i = 0; i < 201; i++) health.record(1, 0);
    expect(onBreakage).toHaveBeenCalledTimes(1);
  });
});
