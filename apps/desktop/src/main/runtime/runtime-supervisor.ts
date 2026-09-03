import type { RuntimeStatus } from '@catbots/contracts';

export type RuntimeWorkerMessage = { type: 'ready' };

export interface RuntimeWorkerPort {
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'error', listener: (...details: unknown[]) => void): this;
  removeListener?(event: 'message' | 'exit' | 'error', listener: (...details: unknown[]) => void): this;
  postMessage(message: { type: 'shutdown' }): void;
  kill(): boolean;
}

export type RuntimeSupervisorOptions = {
  shutdownTimeoutMs?: number;
};

type ActiveWorker = {
  generation: number;
  port: RuntimeWorkerPort;
  onMessage: (message: unknown) => void;
  onExit: (...details: unknown[]) => void;
  onError: (...details: unknown[]) => void;
  shutdownTimer?: ReturnType<typeof setTimeout>;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 250;

export class RuntimeSupervisor {
  private activeWorker: ActiveWorker | undefined;
  private generation = 0;
  private status: RuntimeStatus = { state: 'stopped', activeBots: 0 };
  private readonly listeners = new Set<(status: RuntimeStatus) => void>();
  private stopPromise: Promise<void> | undefined;
  private resolveStop: (() => void) | undefined;
  private readonly shutdownTimeoutMs: number;

  constructor(
    private readonly createWorker: () => RuntimeWorkerPort,
    options: RuntimeSupervisorOptions = {},
  ) {
    this.shutdownTimeoutMs = Math.max(0, options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
  }

  start(): void {
    if (this.activeWorker !== undefined || !canStart(this.status.state)) return;

    this.setState('starting');
    let port: RuntimeWorkerPort;
    try {
      port = this.createWorker();
    } catch {
      this.setState('error');
      return;
    }

    const generation = ++this.generation;
    const active: ActiveWorker = {
      generation,
      port,
      onMessage: (message) => this.handleMessage(generation, port, message),
      onExit: () => this.handleExit(generation, port),
      onError: () => this.handleError(generation, port),
    };
    this.activeWorker = active;
    port.on('message', active.onMessage);
    port.on('exit', active.onExit);
    port.on('error', active.onError);
  }

  getStatus(): RuntimeStatus {
    return { ...this.status };
  }

  subscribeStatus(listener: (status: RuntimeStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;

    const active = this.activeWorker;
    if (active === undefined) {
      if (this.status.state !== 'stopped') this.setState('stopped');
      return Promise.resolve();
    }

    this.setState('stopping');
    this.stopPromise = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });

    try {
      active.port.postMessage({ type: 'shutdown' });
    } catch {
      this.escalateStop(active);
      return this.stopPromise;
    }

    active.shutdownTimer = setTimeout(() => this.escalateStop(active), this.shutdownTimeoutMs);
    return this.stopPromise;
  }

  private handleMessage(generation: number, port: RuntimeWorkerPort, message: unknown): void {
    if (!this.isCurrent(generation, port) || this.status.state !== 'starting') return;
    if (isReadyMessage(message)) this.setState('ready');
  }

  private handleExit(generation: number, port: RuntimeWorkerPort): void {
    const active = this.activeWorker;
    if (active === undefined || active.generation !== generation || active.port !== port) return;

    if (this.status.state === 'stopping') {
      this.finishStop(active);
      return;
    }

    this.releaseWorker(active);
    this.setState('error');
  }

  private handleError(generation: number, port: RuntimeWorkerPort): void {
    if (!this.isCurrent(generation, port) || this.status.state === 'stopping') return;
    this.setState('error');
  }

  private escalateStop(active: ActiveWorker): void {
    if (!this.isCurrent(active.generation, active.port) || this.status.state !== 'stopping') return;
    try {
      active.port.kill();
    } catch {
      // The lifecycle must still converge when a platform reports a failed kill.
    }
    this.finishStop(active);
  }

  private finishStop(active: ActiveWorker): void {
    if (!this.isCurrent(active.generation, active.port)) return;
    this.releaseWorker(active);
    this.setState('stopped');
    const resolve = this.resolveStop;
    this.resolveStop = undefined;
    this.stopPromise = undefined;
    resolve?.();
  }

  private releaseWorker(active: ActiveWorker): void {
    if (active.shutdownTimer !== undefined) clearTimeout(active.shutdownTimer);
    active.port.removeListener?.('message', active.onMessage);
    active.port.removeListener?.('exit', active.onExit);
    active.port.removeListener?.('error', active.onError);
    if (this.activeWorker === active) this.activeWorker = undefined;
  }

  private isCurrent(generation: number, port: RuntimeWorkerPort): boolean {
    return this.activeWorker?.generation === generation && this.activeWorker.port === port;
  }

  private setState(state: RuntimeStatus['state']): void {
    if (this.status.state === state) return;
    this.status = { state, activeBots: 0 };
    for (const listener of this.listeners) {
      try {
        listener(this.getStatus());
      } catch {
        // One renderer subscription must not break runtime supervision.
      }
    }
  }
}

function canStart(state: RuntimeStatus['state']): boolean {
  return state === 'stopped' || state === 'error';
}

function isReadyMessage(message: unknown): message is RuntimeWorkerMessage {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'ready';
}
