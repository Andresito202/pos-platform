export type RuntimeState = "CREATED" | "STARTING" | "READY" | "STOPPING" | "STOPPED" | "FAILED";
export interface RuntimeComponent {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class ServiceLifecycle {
  private stateValue: RuntimeState = "CREATED";
  private readonly started: RuntimeComponent[] = [];
  constructor(private readonly components: readonly RuntimeComponent[]) {
    const names = components.map((component) => component.name);
    if (new Set(names).size !== names.length) throw new Error("runtime component names must be unique");
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
      const rollbackErrors: unknown[] = [];
      for (const component of [...this.started].reverse()) {
        try { await component.stop(); } catch (error) { rollbackErrors.push(error); }
      }
      this.started.length = 0;
      throw new AggregateError([cause, ...rollbackErrors], "runtime start failed");
    }
  }

  async stop(): Promise<void> {
    if (this.stateValue === "STOPPED") return;
    if (this.stateValue !== "READY" && this.stateValue !== "FAILED") throw new Error(`cannot stop runtime from ${this.stateValue}`);
    this.stateValue = "STOPPING";
    const errors: unknown[] = [];
    for (const component of [...this.started].reverse()) {
      try { await component.stop(); } catch (error) { errors.push(error); }
    }
    this.started.length = 0;
    this.stateValue = errors.length === 0 ? "STOPPED" : "FAILED";
    if (errors.length > 0) throw new AggregateError(errors, "runtime stop failed");
  }
}
