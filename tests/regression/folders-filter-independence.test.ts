import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createDataLifecycle } from "@/background/data-lifecycle";
import { createFilterApplier } from "@/content/filter-applier";
import { FilterAttributes } from "@/content/filter-attributes";
import { Selectors } from "@/content/selectors";
import type { CacheObservation } from "@/core/cache-observation";
import { createFilterStore } from "@/core/filter-store";
import type { CollectionsRequest, DefaultSaveOutcome } from "@/core/protocol/collections";
import { createCollectionStore } from "@/packages/folders";
import type { PostCapture } from "@/packages/folders/types";

import { createMemoryArea } from "../helpers/chrome-fake";

/**
 * Story 66: Folders and the Filter are independent in both directions. This is
 * pinned two ways — a round-trip proving the behavior, and a source-level scan
 * banning the import that would let it regress silently (folders-is-headless.test.ts
 * pins the neighbouring "folders knows no browser" property the same way).
 */

const TYPE = "lasso:collections";
const STATUS = "1234567890";

/** The worker's collections authority, driven exactly as the content script would. */
function worker() {
  const local = createMemoryArea();
  const indexedDB = new IDBFactory();
  const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
    open: () => createCollectionStore({ indexedDB, keyRange: IDBKeyRange }),
  });
  const run = (request: CollectionsRequest) => lifecycle.collections(request);
  const token = async () =>
    ((await run({ type: TYPE, operation: "begin" })) as { token: CacheObservation }).token;
  return { run, token };
}

const testids = (selector: string): string[] =>
  [...selector.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]!);
const testid = (selector: string): string => testids(selector)[0]!;
const CELL_TESTID = testid(Selectors.CELL);
const TWEET_TESTID = testid(Selectors.TWEET);
const TWEET_TEXT_TESTID = testid(Selectors.TWEET_TEXT);

describe("Folders are independent of the Filter (story 66)", () => {
  it("saves a post, then survives the Filter collapsing and re-showing its cell", async () => {
    const w = worker();
    const capture: PostCapture = {
      statusId: STATUS,
      permalink: `https://x.com/jack/status/${STATUS}`,
      media: [],
    };
    const saved = (
      (await w.run({
        type: TYPE,
        operation: "save-to-default-folder",
        capture,
        token: await w.token(),
      })) as { defaultSave: DefaultSaveOutcome }
    ).defaultSave;
    if (saved.status !== "saved") throw new Error("expected a save");
    await w.run({
      type: TYPE,
      operation: "set-note",
      statusId: STATUS,
      note: "worth revisiting",
      token: await w.token(),
    });
    await w.run({
      type: TYPE,
      operation: "set-tags",
      statusId: STATUS,
      tags: ["design"],
      token: await w.token(),
    });
    const before = await w.run({ type: TYPE, operation: "get-saved-post", statusId: STATUS });
    const beforeFolders = await w.run({
      type: TYPE,
      operation: "folders-holding",
      statusId: STATUS,
    });

    // The Filter, wired up separately and unaware any of the above happened,
    // collapses the post's cell to the reversible stub and the user un-hides it.
    const filter = createFilterStore({ navLanguages: ["en"] });
    filter.setMode("kind:video", "only"); // arms a criterion this text post fails
    const root = document.createElement("div");
    document.body.append(root);
    const cell = document.createElement("div");
    cell.setAttribute("data-testid", CELL_TESTID);
    cell.innerHTML = `<article data-testid="${TWEET_TESTID}"><div data-testid="${TWEET_TEXT_TESTID}" lang="en">hi</div><a href="/jack/status/${STATUS}">link</a></article>`;
    root.append(cell);
    const applier = createFilterApplier({ store: filter, root, inScope: () => true });
    const article = cell.querySelector(Selectors.TWEET) as Element;

    applier.classify(article);
    expect(applier.isStubbed(cell)).toBe(true);
    (cell.querySelector(`[${FilterAttributes.STUB}]`) as HTMLElement).click();
    expect(applier.isStubbed(cell)).toBe(false);
    applier.dispose();

    const after = await w.run({ type: TYPE, operation: "get-saved-post", statusId: STATUS });
    const afterFolders = await w.run({
      type: TYPE,
      operation: "folders-holding",
      statusId: STATUS,
    });
    expect(after).toEqual(before);
    expect(afterFolders).toEqual(beforeFolders);
  });
});

/**
 * Same shape as tests/regression/folders-is-headless.test.ts's guard: a runtime
 * check can't see this, because nothing here would actually throw if the two
 * halves acquired a dependency on each other — only a source scan can.
 */
const FILTER_FILES = [
  "src/core/filter-criteria.ts",
  "src/core/filter-domain.ts",
  "src/core/filter-projection.ts",
  "src/core/filter-store.ts",
  "src/core/filter-types.ts",
  "src/core/timeline-filter.ts",
  "src/content/filter-applier.ts",
  "src/content/filter-attributes.ts",
  "src/content/filter-feature.ts",
];

const COLLECTIONS_IMPORT = /["']@\/(?:background\/data-lifecycle\/collections|packages\/folders)/;
const FILTER_IMPORT = /["']@\/(?:core\/(?:filter-|timeline-filter)|content\/filter-)/;

function folderPackageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return folderPackageFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("no cross-import between the Filter and collections", () => {
  it("no filter module imports folders or the worker's collections authority", () => {
    const repoRoot = join(__dirname, "../..");
    const offenders = FILTER_FILES.filter((relative) =>
      COLLECTIONS_IMPORT.test(readFileSync(join(repoRoot, relative), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no collections operation imports the Filter", () => {
    const repoRoot = join(__dirname, "../..");
    const collectionsSource = readFileSync(
      join(repoRoot, "src/background/data-lifecycle/collections.ts"),
      "utf8",
    );
    expect(FILTER_IMPORT.test(collectionsSource)).toBe(false);
    const offenders = folderPackageFiles(join(repoRoot, "src/packages/folders")).filter((path) =>
      FILTER_IMPORT.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
