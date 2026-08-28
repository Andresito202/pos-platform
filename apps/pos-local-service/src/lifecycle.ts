export type RuntimeState = "CREATED" | "STARTING" | "READY" | "STOPPING" | "STOPPED" | "FAILED";
export interface RuntimeComponent {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class ServiceLifecycle {
  private stateValue: RuntimeState = "CREATED";
  private readonly started: RuntimeComponent[] = [];
  private stopPromise: Promise<void> | undefined;

  constructor(
    private readonly components: readonly RuntimeComponent[],
    private readonly componentStopTimeoutMs = 10_000,
  ) {
    const names = components.map((component) => component.name);
    if (new Set(names).size !== names.length) throw new Error("runtime component names must be unique");
    if (!Number.isSafeInteger(componentStopTimeoutMs) || componentStopTimeoutMs <= 0) {
      throw new Error("component stop timeout must be a positive integer");
    }
  }

  get state(): RuntimeState { return this.stateValue; }

  async start(): Promise<void> {
    if (this.stateValue !== "CREATED") throw new Error(`cannot start runtime from ${this.stateValue}`);
    this.stateValue = "STARTING";
    try {
      for (const component of this.components) {
        await component.start();
        this.started.push(component);
      }
      this.stateValue = "READY";
    } catch (cause) {
      this.stateValue = "FAILED";
      const rollbackErrors = await this.stopStartedComponents();
      throw new AggregateError([cause, ...rollbackErrors], "runtime start failed");
    }
  }

  stop(): Promise<void> {
    if (this.stateValue === "STOPPED") return Promise.resolve();
    if (this.stateValue === "STOPPING" && this.stopPromise) return this.stopPromise;
    if (this.stateValue !== "READY" && this.stateValue !== "FAILED") {
      return Promise.reject(new Error(`cannot stop runtime from ${this.stateValue}`));
    }

    this.stateValue = "STOPPING";
    const operation = (async () => {
      const errors = await this.stopStartedComponents();
      if (errors.length > 0) {
        this.stateValue = "FAILED";
        throw new AggregateError(errors, "runtime stop failed");
      }
      this.stateValue = "STOPPED";
    })();
    this.stopPromise = operation.finally(() => {
      if (this.stateValue !== "STOPPING") this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  private async stopStartedComponents(): Promise<unknown[]> {
    const errors: unknown[] = [];
    const failed: RuntimeComponent[] = [];
    for (const component of [...this.started].reverse()) {
      try {
        await withTimeout(component.stop(), this.componentStopTimeoutMs, `runtime component ${component.name} stop`);
      } catch (error) {
        errors.push(error);
        failed.push(component);
      }
    }
    this.started.length = 0;
    for (const component of failed.reverse()) this.started.push(component);
    return errors;
  }
}
