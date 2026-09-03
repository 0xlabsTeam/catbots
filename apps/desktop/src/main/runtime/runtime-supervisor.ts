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

export class RuntimeStopError extends Error {
  readonly code = 'RUNTIME_STOP_FAILED';

  constructor() {
    super('RUNTIME_STOP_FAILED');
    this.name = 'RuntimeStopError';
  }
}

type ActiveWorker = {
  generation: number;
  port: RuntimeWorkerPort;
  onMessage: (message: unknown) => void;
  onExit: (...details: unknown[]) => void;
  onError: (...details: unknown[]) => void;
  shutdownTimer?: ReturnType<typeof setTimeout>;
  stopRequested: boolean;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 250;

export class RuntimeSupervisor {
  private activeWorker: ActiveWorker | undefined;
  private generation = 0;
  private status: RuntimeStatus = { state: 'stopped', activeBots: 0 };
  private readonly listeners = new Set<(status: RuntimeStatus) => void>();
  private stopPromise: Promise<void> | undefined;
  private resolveStop: (() => void) | undefined;
  private rejectStop: ((error: RuntimeStopError) => void) | undefined;
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
      stopRequested: false,
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
    active.stopRequested = true;
    const stopping = new Promise<void>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    this.stopPromise = stopping;

    try {
      active.port.postMessage({ type: 'shutdown' });
    } catch {
      this.escalateStop(active);
      return stopping;
    }

    active.shutdownTimer = setTimeout(() => this.escalateStop(active), this.shutdownTimeoutMs);
    return stopping;
  }

  private handleMessage(generation: number, port: RuntimeWorkerPort, message: unknown): void {
    if (!this.isCurrent(generation, port) || this.status.state !== 'starting') return;
    if (isReadyMessage(message)) this.setState('ready');
  }

  private handleExit(generation: number, port: RuntimeWorkerPort): void {
    const active = this.activeWorker;
    if (active === undefined || active.generation !== generation || active.port !== port) return;

    if (active.stopRequested) {
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
      if (!active.port.kill()) {
        this.failStop(active);
        return;
      }
    } catch {
      this.failStop(active);
      return;
    }
    this.finishStop(active);
  }

  private finishStop(active: ActiveWorker): void {
    if (!this.isCurrent(active.generation, active.port)) return;
    this.releaseWorker(active);
    this.setState('stopped');
    const resolve = this.resolveStop;
    this.resolveStop = undefined;
    this.rejectStop = undefined;
    this.stopPromise = undefined;
    resolve?.();
  }

  private failStop(active: ActiveWorker): void {
    if (!this.isCurrent(active.generation, active.port)) return;
    if (active.shutdownTimer !== undefined) {
      clearTimeout(active.shutdownTimer);
      active.shutdownTimer = undefined;
    }
    this.setState('error');
    const reject = this.rejectStop;
    this.resolveStop = undefined;
    this.rejectStop = undefined;
    this.stopPromise = undefined;
    reject?.(new RuntimeStopError());
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
