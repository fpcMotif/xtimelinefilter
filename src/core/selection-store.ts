import { computed, type ReadonlySignal, signal } from "@preact/signals-core";

/** A tweet's author — the unit that gets added to an X List. */
export interface TweetAuthor {
  /** handle without the leading "@" */
  screenName: string;
  /** X numeric id (rest_id); may be unknown until resolved */
  userId?: string;
  displayName?: string;
  avatarUrl?: string;
  /** id of the tweet this author was selected from */
  tweetId?: string;
}

export interface SelectionStore {
  readonly count: ReadonlySignal<number>;
  readonly selectMode: ReadonlySignal<boolean>;
  isSelected(screenName: string): boolean;
  add(author: TweetAuthor): void;
  remove(screenName: string): void;
  toggle(author: TweetAuthor): void;
  clear(): void;
  setSelectMode(on: boolean): void;
  list(): TweetAuthor[];
}

const keyOf = (screenName: string): string => screenName.toLowerCase();

/**
 * Reactive, framework-agnostic store of the currently selected tweet authors.
 * Keyed case-insensitively by screen name; signals make it consumable from
 * Preact components and from plain code alike.
 */
export function createSelectionStore(): SelectionStore {
  const selected = signal<ReadonlyMap<string, TweetAuthor>>(new Map());
  const selectMode = signal(false);
  const count = computed(() => selected.value.size);

  const mutate = (fn: (next: Map<string, TweetAuthor>) => void): void => {
    const next = new Map(selected.value);
    fn(next);
    selected.value = next;
  };

  return {
    count,
    selectMode,
    isSelected: (screenName) => selected.value.has(keyOf(screenName)),
    add: (author) =>
      mutate((next) => {
        const key = keyOf(author.screenName);
        const prev = next.get(key);
        // Keep the first-seen identity (e.g. screenName casing); fill in fields
        // we didn't know yet (e.g. a freshly resolved userId).
        next.set(key, prev ? { ...author, ...prev } : author);
      }),
    remove: (screenName) =>
      mutate((next) => {
        next.delete(keyOf(screenName));
      }),
    toggle: (author) =>
      mutate((next) => {
        const key = keyOf(author.screenName);
        if (next.has(key)) next.delete(key);
        else next.set(key, author);
      }),
    clear: () =>
      mutate((next) => {
        next.clear();
      }),
    setSelectMode: (on) => {
      selectMode.value = on;
    },
    list: () => [...selected.value.values()],
  };
}
