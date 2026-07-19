/** Badge state reannouncement across document lifecycle restores. */

export type BadgeActivationState = "idle" | "booting" | "awake";

export interface BadgeReannouncerDeps {
  activationState(): BadgeActivationState;
  publishDormant(): void;
}

/**
 * Owns the one live awake reporter. Its disposer cannot clear a reporter from
 * a later successful install, which makes activation rollback safe.
 */
export function createBadgeReannouncer(deps: BadgeReannouncerDeps) {
  let awakeReporter: (() => void) | null = null;

  return {
    setAwakeReporter(reporter: () => void): () => void {
      awakeReporter = reporter;
      return () => {
        if (awakeReporter === reporter) awakeReporter = null;
      };
    },
    reannounce(): void {
      const state = deps.activationState();
      if (state === "awake") awakeReporter?.();
      else if (state === "idle") deps.publishDormant();
    },
  };
}
