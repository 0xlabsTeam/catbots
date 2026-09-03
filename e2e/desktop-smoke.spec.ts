import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, realpath, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { cleanupApplication } from './cleanup';

type LifecycleTestSeam = {
  openMainWindow(): Promise<void>;
  requestQuit(response: number): Promise<void>;
};

async function findPackagedExecutable(directory: string): Promise<string> {
  const packageDirectories = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const candidates = (await Promise.all(packageDirectories.map(async (entry) => (await readdir(join(directory, entry.name), { withFileTypes: true }))
    .filter((child) => child.isDirectory() && child.name.endsWith('.app'))
    .map((child) => join(directory, entry.name, child.name, 'Contents', 'MacOS', child.name.slice(0, -4)))))).flat();
  if (candidates.length !== 1) throw new Error(`Expected one current-host packaged app, found ${candidates.length}`);
  return candidates[0]!;
}

async function launchFreshApplication(): Promise<{ app: ElectronApplication; dataDirectory: string; process: ChildProcess }> {
  const dataDirectory = await mkdtemp(join(await realpath(tmpdir()), 'catbots-e2e-'));
  try {
    const app = await electron.launch({
      executablePath: await findPackagedExecutable(resolve('apps/desktop/out')),
      args: [],
      env: { ...process.env, CATBOTS_E2E_DATA_DIR: dataDirectory, NODE_ENV: 'test' },
    });
    return { app, dataDirectory, process: app.process() };
  } catch (error) {
    await rm(dataDirectory, { force: true, recursive: true });
    throw error;
  }
}

function waitForExit(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => process.once('exit', () => resolveExit()));
}

async function waitForExitWithin(process: ChildProcess, milliseconds: number): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return true;
  return new Promise((resolveExit) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    const timeout = setTimeout(() => {
      process.off('exit', onExit);
      resolveExit(false);
    }, milliseconds);
    process.once('exit', onExit);
  });
}

async function closeApplication(app: ElectronApplication | undefined, process: ChildProcess | undefined, dataDirectory: string | undefined): Promise<void> {
  await cleanupApplication({
    app,
    dataDirectory,
    process,
    removeDirectory: async (directory: string) => rm(directory, { force: true, recursive: true }),
    waitForExitWithin,
  });
}

test('fresh install reaches local-profile onboarding', async () => {
  let app: ElectronApplication | undefined;
  let process: ChildProcess | undefined;
  let dataDirectory: string | undefined;
  try {
    ({ app, dataDirectory, process } = await launchFreshApplication());
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Create your local profile' })).toBeVisible();
  } finally {
    await closeApplication(app, process, dataDirectory);
  }
});

test('close-to-tray lifecycle keeps the runtime alive and native quit respects cancel then confirmation', async () => {
  let app: ElectronApplication | undefined;
  let process: ChildProcess | undefined;
  let dataDirectory: string | undefined;
  try {
    ({ app, dataDirectory, process } = await launchFreshApplication());
    await app.firstWindow();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(async () => (await app!.windows()).length).toBe(0);
    expect(process!.exitCode).toBeNull();

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
    expect(process!.exitCode).toBeNull();

    const exited = waitForExit(process!);
    await app.evaluate(async () => {
      const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
      if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
      await seam.requestQuit(0);
    });
    await exited;
  } finally {
    await closeApplication(app, process, dataDirectory);
  }
});
