import { describe, expect, it } from "vitest";

import { greet } from "../index";

describe("example package", () => {
  it("greets through the entry point", () => {
    expect(greet("Lasso")).toBe("Hello, Lasso!");
  });
});
