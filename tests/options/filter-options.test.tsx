import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { LinkRulesEditor, MyLanguagesEditor } from "@/options/FilterOptions";

describe("MyLanguagesEditor", () => {
  it("removes a language from the allowlist", () => {
    const store = createFilterStore({ navLanguages: ["ja", "en"] });
    const r = render(<MyLanguagesEditor store={store} />);
    fireEvent.click(r.getByLabelText(/remove en/i));
    expect(store.state.value.myLanguages).toEqual(["ja"]);
  });

  it("adds a language (normalized) to the allowlist", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    const r = render(<MyLanguagesEditor store={store} />);
    fireEvent.input(r.getByLabelText(/language to add/i), { target: { value: "ko-KR" } });
    fireEvent.click(r.getByRole("button", { name: /add language/i }));
    expect(store.state.value.myLanguages).toEqual(["ja", "ko"]);
  });
});

describe("LinkRulesEditor", () => {
  it("adds a custom host → destination rule", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<LinkRulesEditor store={store} />);
    fireEvent.input(r.getByLabelText(/rule host/i), { target: { value: "lobste.rs" } });
    fireEvent.change(r.getByLabelText(/rule destination/i), { target: { value: "hn" } });
    fireEvent.click(r.getByRole("button", { name: /add rule/i }));
    expect(store.state.value.linkRules).toEqual([{ host: "lobste.rs", dest: "hn" }]);
  });

  it("rejects a blank host", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<LinkRulesEditor store={store} />);
    fireEvent.click(r.getByRole("button", { name: /add rule/i }));
    expect(store.state.value.linkRules).toEqual([]);
  });

  it("removes an existing rule", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setLinkRules([{ host: "lobste.rs", dest: "hn" }]);
    const r = render(<LinkRulesEditor store={store} />);
    fireEvent.click(r.getByLabelText(/remove rule lobste\.rs/i));
    expect(store.state.value.linkRules).toEqual([]);
  });
});
