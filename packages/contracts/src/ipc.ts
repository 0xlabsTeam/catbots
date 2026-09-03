import type { BotSummary } from './bots';
import type { RedactedLocalConfig } from './config';

export type RuntimeStatus = {
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';
  activeBots: number;
};

export type BootstrapState =
  | { state: 'first-launch' }
  | { state: 'ready'; config: RedactedLocalConfig }
  | { state: 'repair'; issues: Array<{ path: string; message: string }> };

export type ConnectionTestResult =
  | { ok: true; model: string }
  | { ok: false; code: string; message: string };

export interface CatbotsDesktopApi {
  app: {
    getVersion(): Promise<string>;
    showMainWindow(): Promise<void>;
    quitApplication(): Promise<void>;
  };
  config: {
    getBootstrapState(): Promise<BootstrapState>;
    save(input: unknown): Promise<RedactedLocalConfig>;
    testLlmConnection(input: unknown): Promise<ConnectionTestResult>;
  };
  bots: {
    list(): Promise<BotSummary[]>;
    createDraft(input: unknown): Promise<BotSummary>;
  };
  runtime: {
    getStatus(): Promise<RuntimeStatus>;
    subscribeStatus(listener: (status: RuntimeStatus) => void): () => void;
  };
}
