import { describe, expect, it } from "vitest";

import { UI_LAYER } from "@/ui/layers";

describe("UI layer policy", () => {
  it("keeps the passive pill below app chrome and modal surfaces above both", () => {
    expect(UI_LAYER.pill).toBeLessThan(UI_LAYER.app);
    expect(UI_LAYER.app).toBeLessThan(UI_LAYER.modal);
  });
});
