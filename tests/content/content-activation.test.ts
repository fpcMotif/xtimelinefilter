import { describe, expect, it, vi } from "vitest";

import {
  createContentActivation,
  type ActivationLifecycle,
  type InitialActivationMode,
} from "@/content/content-activation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function harness() {
  const controller = { trySelectMode: vi.fn(), wake: vi.fn() };
  const install = vi.fn<(lifecycle: ActivationLifecycle) => Promise<typeof controller>>(
    async () => controller,
  );
  const installDormantSelectMode = vi.fn();
  const readInitialMode = vi.fn<() => Promise<InitialActivationMode>>(async () => "on-demand");
  const delay = vi.fn(async (_ms: number) => {});
  const publishState = vi.fn();
  const reportError = vi.fn();
  const activation = createContentActivation({
    install,
    installDormantSelectMode,
    readInitialMode,
    delay,
    publishState,
    reportError,
  });
  return {
    activation,
    controller,
    install,
    installDormantSelectMode,
    readInitialMode,
    delay,
    publishState,
    reportError,
  };
}

describe("content activation", () => {
  it("retries a transient initial read and auto-installs without user input", async () => {
    const h = harness();
    h.readInitialMode.mockRejectedValueOnce(new Error("storage waking"));
    h.readInitialMode.mockResolvedValueOnce("auto");

    await h.activation.initialize();

    expect(h.delay).toHaveBeenCalledWith(50);
    expect(h.install).toHaveBeenCalledOnce();
    expect(h.activation.state()).toBe("awake");
    expect(h.publishState).toHaveBeenCalledTimes(1);
    expect(h.publishState).toHaveBeenCalledWith("awake");
  });

  it("retries a transient auto-install failure without user input", async () => {
    const h = harness();
    h.readInitialMode.mockResolvedValue("auto");
    h.install.mockRejectedValueOnce(new Error("document still hydrating"));

    await h.activation.initialize();

    expect(h.delay).toHaveBeenCalledWith(50);
    expect(h.install).toHaveBeenCalledTimes(2);
    expect(h.activation.state()).toBe("awake");
    expect(h.publishState).toHaveBeenLastCalledWith("awake");
  });

  it("lets a user wake win while bootstrap waits to retry", async () => {
    const h = harness();
    const retry = deferred<void>();
    h.readInitialMode.mockRejectedValueOnce(new Error("storage waking"));
    h.delay.mockReturnValueOnce(retry.promise);

    const bootstrap = h.activation.initialize();
    await vi.waitFor(() => expect(h.delay).toHaveBeenCalledWith(50));
    await expect(h.activation.activate("wake")).resolves.toBe(true);
    retry.resolve();
    await bootstrap;

    expect(h.install).toHaveBeenCalledOnce();
    expect(h.controller.wake).toHaveBeenCalledOnce();
    expect(h.publishState).toHaveBeenCalledTimes(1);
    expect(h.publishState).toHaveBeenCalledWith("awake");
  });

  it("publishes permanent on-demand dormancy once", async () => {
    const h = harness();

    await h.activation.initialize();

    expect(h.install).not.toHaveBeenCalled();
    expect(h.publishState).toHaveBeenCalledTimes(1);
    expect(h.publishState).toHaveBeenCalledWith("asleep");
  });

  it("reports an initial-mode read only after every retry is exhausted", async () => {
    const h = harness();
    const error = new Error("storage unavailable");
    h.readInitialMode.mockRejectedValue(error);

    await h.activation.initialize();

    expect(h.delay).toHaveBeenNthCalledWith(1, 50);
    expect(h.delay).toHaveBeenNthCalledWith(2, 100);
    expect(h.delay).toHaveBeenNthCalledWith(3, 200);
    expect(h.publishState).toHaveBeenCalledWith("asleep");
    expect(h.reportError).toHaveBeenCalledWith("[Lasso] initial activation mode failed", error);
  });

  it("stops a failed auto-install when retry delays are disabled", async () => {
    const h = harness();
    h.readInitialMode.mockResolvedValue("auto");
    h.install.mockRejectedValue(new Error("install failed"));
    const activation = createContentActivation({
      install: h.install,
      installDormantSelectMode: h.installDormantSelectMode,
      readInitialMode: h.readInitialMode,
      delay: h.delay,
      publishState: h.publishState,
      reportError: h.reportError,
      retryDelaysMs: [],
    });

    await activation.initialize();

    expect(h.delay).not.toHaveBeenCalled();
    expect(h.install).toHaveBeenCalledOnce();
  });

  it("moves idle through booting to awake", async () => {
    const h = harness();
    const boot = deferred<typeof h.controller>();
    h.install.mockReturnValueOnce(boot.promise);

    const attempt = h.activation.activate("silent");
    expect(h.activation.state()).toBe("booting");
    boot.resolve(h.controller);

    await expect(attempt).resolves.toBe(true);
    expect(h.activation.state()).toBe("awake");
    expect(h.publishState).toHaveBeenCalledWith("awake");
  });

  it("coalesces queued wake and select-mode intents", async () => {
    const h = harness();
    const boot = deferred<typeof h.controller>();
    h.install.mockReturnValueOnce(boot.promise);

    const first = h.activation.activate("silent");
    const second = h.activation.activate("wake");
    const third = h.activation.activate("select-mode");
    expect(second).toBe(first);
    expect(third).toBe(first);
    boot.resolve(h.controller);

    await first;
    expect(h.controller.wake).toHaveBeenCalledOnce();
    expect(h.controller.trySelectMode).toHaveBeenCalledOnce();
  });

  it("returns idle after a failed install and retries", async () => {
    const h = harness();
    h.install.mockRejectedValueOnce(new Error("broken"));

    await expect(h.activation.activate("wake")).resolves.toBe(false);
    expect(h.activation.state()).toBe("idle");
    expect(h.publishState).toHaveBeenLastCalledWith("asleep");
    await expect(h.activation.activate("wake")).resolves.toBe(true);
    expect(h.controller.wake).toHaveBeenCalledOnce();
  });

  it("keeps dormant select mode until a successful install", async () => {
    const h = harness();
    const dispose = vi.fn();
    let request!: () => void;
    h.installDormantSelectMode.mockImplementation((next) => {
      request = next;
      return dispose;
    });
    h.install.mockRejectedValueOnce(new Error("broken"));

    h.activation.ensureDormantKeyboard();
    h.activation.ensureDormantKeyboard();
    expect(h.installDormantSelectMode).toHaveBeenCalledOnce();
    request();
    await vi.waitFor(() => expect(h.activation.state()).toBe("idle"));
    expect(dispose).not.toHaveBeenCalled();

    request();
    await vi.waitFor(() => expect(h.activation.state()).toBe("awake"));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("reannounces a registered awake reporter and isolates intent errors", async () => {
    const h = harness();
    let reporter!: () => void;
    h.install.mockImplementationOnce(async (lifecycle) => {
      reporter = vi.fn();
      lifecycle.setAwakeReporter(reporter);
      h.controller.wake.mockImplementationOnce(() => {
        throw new Error("wake failed");
      });
      return h.controller;
    });

    await h.activation.activate("wake");
    h.activation.reannounce();

    expect(reporter).toHaveBeenCalledOnce();
    expect(h.reportError).toHaveBeenCalledWith("[Lasso] wake intent failed", expect.any(Error));
    expect(h.activation.state()).toBe("awake");
  });
});
