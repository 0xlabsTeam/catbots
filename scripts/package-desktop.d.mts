import type { EventEmitter } from 'node:events';

export type SpawnedChild = EventEmitter & { kill(signal: string): void };
export type RunCommand = (command: string, args: string[], cwd?: string, onSpawn?: (child: SpawnedChild) => void) => Promise<void>;
export function createRunner(spawnCommand?: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' }) => SpawnedChild): RunCommand;
export function runPackaging(options: { rebuildElectron(): Promise<void>; forge(): Promise<void>; restoreHost(): Promise<void> }): Promise<void>;
export function waitForChildExit(child: SpawnedChild): Promise<void>;
export function createSignalController(options: { on(signal: string, handler: () => Promise<void>): void; off(signal: string, handler: () => Promise<void>): void; exit(code: number): void; terminate(signal: string): void; waitForExit(): Promise<void>; restoreHost(): Promise<void>; report?(message: string): void }): { remove(): void };
export function runForgeWithSignalHandling(options: { runCommand: RunCommand; command: string; args: string[]; on(signal: string, handler: () => Promise<void>): void; off(signal: string, handler: () => Promise<void>): void; exit(code: number): void; restoreHost(): Promise<void>; report?(message: string): void }): Promise<void>;
