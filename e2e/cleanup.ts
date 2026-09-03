import type { ChildProcess } from 'node:child_process';

export type CleanupProcess = Pick<ChildProcess, 'kill'>;

export type CleanupOptions = {
  app?: { close(): Promise<void> };
  dataDirectory?: string;
  process?: CleanupProcess;
  removeDirectory(directory: string): Promise<void>;
  waitForExit(process: CleanupProcess): Promise<void>;
  waitForExitWithin(process: CleanupProcess, milliseconds: number): Promise<boolean>;
};

export async function cleanupApplication(options: CleanupOptions): Promise<void> {
  let primaryError: unknown;
  try {
    if (options.app !== undefined) {
      try {
        await options.app.close();
      } catch (error) {
        primaryError = error;
      }
    }
    if (options.process !== undefined && !await options.waitForExitWithin(options.process, 5_000)) {
      options.process.kill('SIGKILL');
      await options.waitForExit(options.process);
      primaryError ??= new Error('Electron did not exit after Playwright close; forced termination was required');
    }
  } catch (error) {
    primaryError ??= error;
  } finally {
    if (options.dataDirectory !== undefined) {
      try {
        await options.removeDirectory(options.dataDirectory);
      } catch (removeError) {
        if (primaryError !== undefined) throw new AggregateError([primaryError, removeError], 'Electron cleanup and data-directory removal failed');
        throw removeError;
      }
    }
  }
  if (primaryError !== undefined) throw primaryError;
}
