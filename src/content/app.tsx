import { type ReadonlySignal, signal } from "@preact/signals-core";
import { useEffect, useState } from "preact/hooks";

const ZERO_TICK = signal(0);

import { assignAuthorsToList } from "@/core/actions/assign-to-list";
import type { ListCache } from "@/core/list-cache";
import type { ListUsage } from "@/core/list-usage";
import { type AssignSummary, summarize } from "@/core/result-summary";
import type { SelectionStore, TweetAuthor } from "@/core/selection-store";
import type { XList, XListApi } from "@/core/x-client/types";
import { ActionBar } from "@/ui/ActionBar";
import { ListPicker } from "@/ui/ListPicker";
import { Toast } from "@/ui/Toast";
import { TweetOverlay } from "@/ui/TweetOverlay";
import { useSignalValue } from "@/ui/use-signal-value";

/** Per-tweet overlay bound to the shared selection store (re-renders on any toggle). */
export function OverlayBinding({
  selection,
  author,
}: {
  selection: SelectionStore;
  author: TweetAuthor;
}) {
  useSignalValue(selection.count);
  return (
    <TweetOverlay
      selected={selection.isSelected(author.screenName)}
      onToggle={() => selection.toggle(author)}
    />
  );
}

export interface AppProps {
  selection: SelectionStore;
  backend: XListApi;
  listCache: ListCache;
  /** Ranks the picker by how often each list is used (frequent lists first). */
  listUsage?: ListUsage;
  /** Bumped by the keyboard layer (Alt+l) to open the picker for the focused author. */
  openPickerTick?: ReadonlySignal<number>;
}

/** The top-level UI: floating action bar, list picker, and result toast. */
export function App({ selection, backend, listCache, listUsage, openPickerTick }: AppProps) {
  const count = useSignalValue(selection.count);
  const tick = useSignalValue(openPickerTick ?? ZERO_TICK);
  const [lists, setLists] = useState<XList[] | null>(null); // non-null = picker open
  const [summary, setSummary] = useState<AssignSummary | null>(null);

  async function openPicker() {
    try {
      const fresh = await listCache.lists({ force: true });
      setLists(listUsage ? await listUsage.rank(fresh) : fresh);
    } catch {
      setLists([]); // logged out / rate-limited — show an empty picker rather than crash
    }
  }

  // Open the picker when the keyboard layer bumps the tick (Alt+l on focused tweet).
  useEffect(() => {
    if (tick > 0) void openPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function pick(list: XList) {
    const authors = selection.list();
    setLists(null);
    void listUsage?.record(list.id);
    const results = await assignAuthorsToList(authors, list, backend);
    selection.clear();
    setSummary(summarize(results));
    window.setTimeout(() => setSummary(null), 4000);
  }

  return (
    <>
      <ActionBar count={count} onAssign={openPicker} onClear={() => selection.clear()} />
      {lists && (
        <div class="fixed bottom-24 left-1/2 z-[2147483646] -translate-x-1/2">
          <ListPicker lists={lists} onPick={pick} onCancel={() => setLists(null)} />
        </div>
      )}
      {summary && <Toast summary={summary} />}
    </>
  );
}
