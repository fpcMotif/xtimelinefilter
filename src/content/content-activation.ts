import { createBadgeReannouncer, type BadgeActivationState } from "@/content/badge-lifecycle";

export type ActivationIntent = "silent" | "wake" | "select-mode";
export type InitialActivationMode = "auto" | "on-demand";

export interface ActivatedContentController {
  wake(): void;
  trySelectMode(): void;
}

export interface ActivationLifecycle {
  setAwakeReporter(reporter: () => void): () => void;
}

export interface ContentActivationDeps {
  install(lifecycle: ActivationLifecycle): Promise<ActivatedContentController>;
  installDormantSelectMode(request: () => void): () => void;
  readInitialMode(): Promise<InitialActivationMode>;
  delay(ms: number): Promise<void>;
  publishState(state: "asleep" | "awake"): void;
  reportError(message: string, error: unknown): void;
  retryDelaysMs?: readonly number[];
}

export interface ContentActivation {
  state(): BadgeActivationState;
  /** Resolve startup mode while leaving a dormant document immediately wakeable. */
  initialize(): Promise<void>;
  activate(intent: ActivationIntent): Promise<boolean>;
  ensureDormantKeyboard(): void;
  reannounce(): void;
}

/** Owns content activation state, deferred intents, and badge restoration. */
export function createContentActivation(deps: ContentActivationDeps) {
  let activationState: BadgeActivationState = "idle";
  let boot: Promise<boolean> | null = null;
  let wakeAfterCommit = false;
  let selectModeAfterCommit = false;
  let disposeDormantKeyboard: (() => void) | null = null;
  let dormantPublished = false;
  const retryDelaysMs = deps.retryDelaysMs ?? [50, 100, 200];
  const badgeReannouncer = createBadgeReannouncer({
    activationState: () => activationState,
    publishDormant: () => deps.publishState("asleep"),
  });
  const lifecycle: ActivationLifecycle = {
    setAwakeReporter: (reporter) => badgeReannouncer.setAwakeReporter(reporter),
  };

  const runIntent = (name: "wake" | "select-mode", run: () => void): void => {
    try {
      run();
    } catch (error) {
      deps.reportError(`[Lasso] ${name} intent failed`, error);
    }
  };

  const publishDormant = (): void => {
    if (activationState !== "idle" || dormantPublished) return;
    dormantPublished = true;
    deps.publishState("asleep");
  };

  const activation: ContentActivation = {
    state(): BadgeActivationState {
      return activationState;
    },
    async initialize(): Promise<void> {
      activation.ensureDormantKeyboard();
      for (let attempt = 0; ; attempt += 1) {
        // A user wake/select request owns the lifetime once it starts. A stale
        // bootstrap read must not add an install or overwrite its badge.
        if (activationState !== "idle") return;
        try {
          const mode = await deps.readInitialMode();
          if (activationState !== "idle") return;
          if (mode !== "auto") {
            publishDormant();
            return;
          }
          if (await activation.activate("silent")) return;
          const delay = retryDelaysMs[attempt];
          if (delay === undefined) return;
          await deps.delay(delay);
        } catch (error) {
          if (activationState !== "idle") return;
          const delay = retryDelaysMs[attempt];
          if (delay === undefined) {
            publishDormant();
            deps.reportError("[Lasso] initial activation mode failed", error);
            return;
          }
          await deps.delay(delay);
        }
      }
    },
    ensureDormantKeyboard(): void {
      if (disposeDormantKeyboard || activationState === "awake") return;
      disposeDormantKeyboard = deps.installDormantSelectMode(() => {
        void activation.activate("select-mode");
      });
    },
    reannounce(): void {
      badgeReannouncer.reannounce();
    },
    activate(intent: ActivationIntent): Promise<boolean> {
      if (activationState === "awake") return Promise.resolve(true);
      if (activationState === "booting") {
        if (intent === "wake") wakeAfterCommit = true;
        if (intent === "select-mode") selectModeAfterCommit = true;
        return boot!;
      }

      activationState = "booting";
      wakeAfterCommit = intent === "wake";
      selectModeAfterCommit = intent === "select-mode";
      const attempt = (async (): Promise<boolean> => {
        try {
          const controller = await deps.install(lifecycle);
          activationState = "awake";
          disposeDormantKeyboard?.();
          disposeDormantKeyboard = null;
          dormantPublished = false;
          deps.publishState("awake");
          if (wakeAfterCommit) {
            wakeAfterCommit = false;
            runIntent("wake", () => controller.wake());
          }
          if (selectModeAfterCommit) {
            selectModeAfterCommit = false;
            runIntent("select-mode", () => controller.trySelectMode());
          }
          return true;
        } catch (error) {
          activationState = "idle";
          wakeAfterCommit = false;
          selectModeAfterCommit = false;
          publishDormant();
          deps.reportError("[Lasso] activation failed", error);
          return false;
        }
      })();
      boot = attempt;
      void attempt.finally(() => {
        boot = null;
      });
      return attempt;
    },
  };
  return activation;
}
