import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  sameSettings,
  sameUserVisibleSettings,
  type LassoSettings,
  type SettingsPatch,
  type SettingsStore,
} from "@/core/settings";

interface PendingWrite {
  id: number;
  expected: LassoSettings;
  externalEpoch: number;
  onSaved?: () => void;
  saved: boolean;
}

interface PendingClear {
  superseded: boolean;
}

export interface ClearAttempt {
  /** Adopts defaults only when this clear still owns the settings authority. */
  finish(): boolean;
  /** Retires this clear if it still owns the settings authority. */
  abort(): void;
}

export interface SettingsDraft {
  /** Optimistic settings for controlled UI. */
  current: LassoSettings | null;
  /** Last initial, external, clear-defaults, or fallback-confirmed snapshot. */
  latest: LassoSettings | null;
  loadError: boolean;
  saveError: boolean;
  retry(): void;
  patch(patch: SettingsPatch, onSaved?: () => void): void;
  beginClear(): ClearAttempt;
}

/**
 * One settings authority for Options. It subscribes before reading, keeps
 * optimistic drafts separate from confirmed snapshots, and fences stale work.
 */
export function useSettingsDraft(settings: SettingsStore): SettingsDraft {
  const [current, setCurrent] = useState<LassoSettings | null>(null);
  const [latest, setLatest] = useState<LassoSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const revision = useRef(0);
  const externalEpoch = useRef(0);
  const writeSequence = useRef(0);
  const acceptedWrite = useRef(0);
  const pendingWrites = useRef<PendingWrite[]>([]);
  const pendingClear = useRef<PendingClear | null>(null);
  const authority = useRef<LassoSettings | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const present = (snapshot: LassoSettings): void => {
    setCurrent(snapshot);
  };
  const saved = (write: PendingWrite): void => {
    if (write.saved || write.id !== writeSequence.current) return;
    write.saved = true;
    write.onSaved?.();
  };
  const adopt = (snapshot: LassoSettings): void => {
    authority.current = snapshot;
    setLatest(snapshot);
    present(snapshot);
  };

  useEffect(() => {
    const activeGeneration = ++generation.current;
    let active = true;
    authority.current = null;
    pendingWrites.current = [];
    pendingClear.current = null;
    externalEpoch.current = 0;
    writeSequence.current = 0;
    acceptedWrite.current = 0;
    setCurrent(null);
    setLatest(null);
    setLoadError(false);
    setSaveError(false);
    const acceptSnapshot = (snapshot: LassoSettings): void => {
      if (!active || !mounted.current || generation.current !== activeGeneration) return;
      adopt(snapshot);
      setLoadError(false);
      setSaveError(false);
    };

    const unsubscribe = settings.subscribe((snapshot, origin) => {
      if (!active || !mounted.current || generation.current !== activeGeneration) return;
      revision.current += 1;
      const clear = pendingClear.current;
      if (clear && sameSettings(snapshot, DEFAULT_SETTINGS)) {
        acceptSnapshot(snapshot);
        setSaveError(false);
        return;
      }
      const exactPending = pendingWrites.current.find((write) =>
        sameUserVisibleSettings(write.expected, snapshot),
      );
      // P1 can fail before P2 starts. P2 then persists from confirmed authority,
      // so its local acknowledgement may differ from the optimistic P2 snapshot.
      const fallbackPending =
        exactPending === undefined && origin === "local"
          ? pendingWrites.current.find((write) => write.externalEpoch === externalEpoch.current)
          : undefined;
      const pending = exactPending ?? fallbackPending;
      if (pending) {
        if (
          pending.externalEpoch === externalEpoch.current &&
          pending.id >= acceptedWrite.current
        ) {
          acceptedWrite.current = pending.id;
          authority.current = snapshot;
          // A fallback is confirmed authority that differs from what the form
          // optimistically showed. Resync controlled drafts; exact local acks
          // must leave an in-progress invalid URL alone.
          if (pending === fallbackPending) setLatest(snapshot);
          if (!pendingWrites.current.some((write) => write.id > pending.id)) present(snapshot);
          setSaveError(false);
          saved(pending);
        }
        return;
      }

      externalEpoch.current += 1;
      if (clear) clear.superseded = true;
      acceptSnapshot(snapshot);
    });
    const readRevision = revision.current;
    setLoadError(false);
    void Promise.resolve()
      .then(() => settings.get())
      .then((snapshot) => {
        if (revision.current === readRevision) acceptSnapshot(snapshot);
      })
      .catch(() => {
        if (
          active &&
          mounted.current &&
          generation.current === activeGeneration &&
          revision.current === readRevision
        ) {
          setLoadError(true);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [settings, retryRevision]);

  const retry = useCallback(() => setRetryRevision((value) => value + 1), []);

  const patch = useCallback(
    (patchValue: SettingsPatch, onSaved?: () => void): void => {
      const activeGeneration = generation.current;
      const writeEpoch = externalEpoch.current;
      let previous: LassoSettings | undefined;
      for (const write of pendingWrites.current) {
        if (write.externalEpoch === writeEpoch) previous = write.expected;
      }
      const request: PendingWrite = {
        id: ++writeSequence.current,
        expected: mergeSettings(previous ?? authority.current ?? DEFAULT_SETTINGS, patchValue),
        externalEpoch: writeEpoch,
        onSaved,
        saved: false,
      };
      pendingWrites.current.push(request);
      revision.current += 1;
      present(request.expected);
      setSaveError(false);
      const retire = () => {
        const index = pendingWrites.current.indexOf(request);
        if (index >= 0) pendingWrites.current.splice(index, 1);
      };
      const accept = (snapshot: LassoSettings) => {
        retire();
        if (
          !mounted.current ||
          generation.current !== activeGeneration ||
          externalEpoch.current !== request.externalEpoch
        )
          return;
        if (
          request.id < acceptedWrite.current ||
          !sameUserVisibleSettings(snapshot, request.expected)
        )
          return;
        acceptedWrite.current = request.id;
        authority.current = snapshot;
        if (!pendingWrites.current.some((write) => write.id > request.id)) present(snapshot);
        setSaveError(false);
        saved(request);
      };
      const reject = () => {
        retire();
        if (
          !mounted.current ||
          generation.current !== activeGeneration ||
          externalEpoch.current !== request.externalEpoch ||
          request.id !== writeSequence.current
        )
          return;
        if (authority.current) present({ ...authority.current });
        setSaveError(true);
      };
      try {
        void Promise.resolve(settings.set(patchValue)).then(accept, reject);
      } catch {
        reject();
      }
    },
    [settings],
  );

  const beginClear = useCallback((): ClearAttempt => {
    const clear: PendingClear = { superseded: false };
    pendingClear.current = clear;
    revision.current += 1;
    externalEpoch.current += 1;
    return {
      finish: (): boolean => {
        if (!mounted.current || pendingClear.current !== clear) return false;
        if (clear.superseded) {
          pendingClear.current = null;
          return false;
        }
        adopt(DEFAULT_SETTINGS);
        pendingClear.current = null;
        setSaveError(false);
        return true;
      },
      abort: (): void => {
        if (pendingClear.current === clear) pendingClear.current = null;
      },
    };
  }, []);

  return { current, latest, loadError, saveError, retry, patch, beginClear };
}
