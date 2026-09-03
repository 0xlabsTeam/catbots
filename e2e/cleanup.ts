import type { ChildProcess } from 'node:child_process';

export type CleanupProcess = Pick<ChildProcess, 'kill'>;

export type CleanupOptions = {
  app?: { close(): Promise<void> };
  dataDirectory?: string;
  process?: CleanupProcess;
  removeDirectory(directory: string): Promise<void>;
  waitForCloseWithin?(close: Promise<void>, milliseconds: number): Promise<boolean>;
  waitForExitWithin(process: CleanupProcess, milliseconds: number): Promise<boolean>;
};

const cleanupTimeoutMilliseconds = 5_000;

function waitForCloseWithin(close: Promise<void>, milliseconds: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    close.then(
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/**
 * A bounded forced process exit is a successful cleanup recovery. Cleanup fails
 * only when close cannot be recovered, the process remains alive, or removal fails.
 */
export async function cleanupApplication(options: CleanupOptions): Promise<void> {
  const cleanupErrors: unknown[] = [];
  let closeError: unknown;
  let removeError: unknown;
  try {
    let alreadyExited = false;
    if (options.process !== undefined) {
      try {
        alreadyExited = await options.waitForExitWithin(options.process, 0);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (options.app !== undefined && !alreadyExited) {
      try {
        const close = Promise.resolve().then(() => options.app!.close());
        if (!await (options.waitForCloseWithin ?? waitForCloseWithin)(close, cleanupTimeoutMilliseconds)) {
          closeError = new Error(`Playwright close did not settle within ${cleanupTimeoutMilliseconds}ms`);
        }
      } catch (error) {
        closeError = error;
      }
    }
    if (options.process !== undefined && !alreadyExited) {
      let exited = false;
      try {
        exited = await options.waitForExitWithin(
          options.process,
          closeError === undefined ? cleanupTimeoutMilliseconds : 0,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (!exited) {
        try {
          options.process.kill('SIGKILL');
        } catch (error) {
          cleanupErrors.push(error);
        }
        let exitedAfterKill = false;
        try {
          exitedAfterKill = await options.waitForExitWithin(options.process, cleanupTimeoutMilliseconds);
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (!exitedAfterKill) {
          if (closeError !== undefined) cleanupErrors.push(closeError);
          cleanupErrors.push(new Error(`Electron remained alive ${cleanupTimeoutMilliseconds}ms after forced termination`));
        }
      }
    } else if (options.process === undefined && closeError !== undefined) {
      cleanupErrors.push(closeError);
    }
  } catch (error) {
    cleanupErrors.push(error);
  } finally {
    if (options.dataDirectory !== undefined) {
      try {
        await options.removeDirectory(options.dataDirectory);
      } catch (error) {
        removeError = error;
      }
    }
  }
  if (removeError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError([...cleanupErrors, removeError], 'Electron cleanup and data-directory removal failed');
    }
    throw removeError;
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Electron cleanup failed');
}
