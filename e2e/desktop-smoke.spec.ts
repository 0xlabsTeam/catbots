import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';

type LifecycleTestSeam = {
  openMainWindow(): Promise<void>;
  requestQuit(response: number): Promise<void>;
};

async function launchFreshApplication(): Promise<{ app: ElectronApplication; dataDirectory: string }> {
  const dataDirectory = await mkdtemp(join(await realpath(tmpdir()), 'catbots-e2e-'));
  try {
    const app = await electron.launch({
      args: [resolve('apps/desktop/.vite/build/main.js')],
      env: { ...process.env, CATBOTS_E2E_DATA_DIR: dataDirectory, NODE_ENV: 'test' },
    });
    return { app, dataDirectory };
  } catch (error) {
    await rm(dataDirectory, { force: true, recursive: true });
    throw error;
  }
}

function waitForExit(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => process.once('exit', () => resolveExit()));
}

async function closeApplication(app: ElectronApplication | undefined, dataDirectory: string | undefined): Promise<void> {
  if (app !== undefined) {
    const process = app.process();
    const exited = waitForExit(process);
    try {
      await app.close();
    } catch (error) {
      process.kill('SIGKILL');
      await exited;
      throw error;
    }
    await exited;
  }
  if (dataDirectory !== undefined) await rm(dataDirectory, { force: true, recursive: true });
}

test('fresh install reaches local-profile onboarding', async () => {
  let app: ElectronApplication | undefined;
  let dataDirectory: string | undefined;
  try {
    ({ app, dataDirectory } = await launchFreshApplication());
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Create your local profile' })).toBeVisible();
  } finally {
    await closeApplication(app, dataDirectory);
  }
});

test('close-to-tray lifecycle keeps the runtime alive and native quit respects cancel then confirmation', async () => {
  let app: ElectronApplication | undefined;
  let dataDirectory: string | undefined;
  try {
    ({ app, dataDirectory } = await launchFreshApplication());
    await app.firstWindow();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(async () => (await app!.windows()).length).toBe(0);
    expect(app.process().exitCode).toBeNull();

    const reopenedPromise = app.waitForEvent('window');
    await app.evaluate(async () => {
      const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
      if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
      await seam.openMainWindow();
    });
    const reopened = await reopenedPromise;
    await expect(reopened.getByRole('heading', { name: 'Create your local profile' })).toBeVisible();

    await app.evaluate(async () => {
      const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
      if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
      await seam.requestQuit(1);
    });
    expect(app.process().exitCode).toBeNull();

    const exited = waitForExit(app.process());
    await app.evaluate(async () => {
      const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
      if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
      await seam.requestQuit(0);
    });
    await exited;
  } finally {
    await closeApplication(app, dataDirectory);
  }
});
