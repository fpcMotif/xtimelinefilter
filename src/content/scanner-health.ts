/**
 * Watches the tweet scanner's hit rate so an X redesign reads as a known state,
 * not a vanished product (story beat 8): if the observer churns through >200
 * mutations in a session without a single post match, report breakage once.
 */
export interface ScannerHealthOptions {
  onBreakage: () => void;
  /** Cumulative mutation count that must be exceeded with zero matches. */
  threshold?: number;
}

export interface ScannerHealth {
  record(mutations: number, matches: number): void;
}

export function createScannerHealth(opts: ScannerHealthOptions): ScannerHealth {
  const threshold = opts.threshold ?? 200;
  let mutations = 0;
  let everMatched = false;
  let fired = false;

  return {
    record(batchMutations, batchMatches) {
      mutations += batchMutations;
      if (batchMatches > 0) everMatched = true;
      if (!fired && !everMatched && mutations > threshold) {
        fired = true;
        opts.onBreakage();
      }
    },
  };
}
