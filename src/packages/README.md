# Deep-module packages

Packages under `src/packages/` are deep modules: a lot of behavior behind a
small interface. Layout:

```
src/packages/<name>/
  index.ts        # entry point (a package may expose several, e.g. client.ts)
  lib/            # hidden implementation
  tests/          # co-located tests
```

Code outside a package may import only its entry points — the files at the
package root. Anything inside a subfolder is private. Because the boundary is
"root files vs. everything else," no config change is ever needed when you add
a new folder inside a package.

Four rules are enforced by dependency-cruiser (`.dependency-cruiser.cjs`):

**Entry-point boundary.** Code outside a package (app code, or another
package) may import only that package's root files. Anything nested one level
or deeper — `lib/`, or any other subfolder — is off limits from the outside.

**Intra-package freedom.** Within a single package, files may import each
other however they like. There's no internal layering imposed between a
package's root and its `lib/` — organize the internals however makes sense.

**Tests through entry points.** A package's tests import its entry points
(and their own `tests/` fixtures) just like any other consumer — never the
package's internals, not even their own package's `lib/`.

**No cycles.** No dependency cycles anywhere in the project.

Avoid barrel files: prefer several small, purposeful entry points
(`index.ts`, `client.ts`, `server.ts`, …) over one `index.ts` that re-exports
an entire subtree. A barrel just moves the internals back behind a single
door instead of keeping them genuinely private.

## Ownership

Own an X-facing capability where its behaviour lives. `x-client` owns the
page-scoped X facade: auth, fetch, backend replacement, Lists reads, and quick
REST actions. It also owns the Lists dialog; content injects caret lookup and
the worker cache adapter. `tweet-actions` owns one-tweet UI actions; content
injects keyboard-safe event dispatch. Content does not assemble X transport.

Run the check with `bun run lint:boundaries` (this also runs in CI).

`example/` is a starter template — copy it to start a new package, or delete
it if you don't need the reference.
