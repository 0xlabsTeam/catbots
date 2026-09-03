import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type LifecycleTestSeam = {
  openMainWindow(): Promise<void>;
  requestQuit(response: number): Promise<void>;
};

async function launchFreshApplication(): Promise<{ app: ElectronApplication; dataDirectory: string }> {
  const dataDirectory = await mkdtemp(join(await realpath(tmpdir()), 'catbots-e2e-'));
  const app = await electron.launch({
    executablePath: resolve('apps/desktop/out/Catbots-darwin-arm64/Catbots.app/Contents/MacOS/Catbots'),
    args: [],
    env: {
      ...process.env,
      CATBOTS_E2E_DATA_DIR: dataDirectory,
      NODE_ENV: 'test',
    },
  });
  return { app, dataDirectory };
}

async function closeApplication(app: ElectronApplication | undefined, dataDirectory: string | undefined): Promise<void> {
  await app?.close().catch(() => undefined);
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
    await expect.poll(() => app!.evaluate(({ app: electronApp }) => !electronApp.isQuiting())).toBe(true);

    await app.evaluate(async () => {
      const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
      if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
      await seam.openMainWindow();
    });
    const reopened = await app.waitForEvent('window');
    await expect(reopened.getByRole('heading', { name: 'Create your local profile' })).toBeVisible();

    await app.evaluate(async () => {
      const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
      if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
      await seam.requestQuit(1);
    });
    await expect.poll(() => app!.evaluate(({ app: electronApp }) => !electronApp.isQuiting())).toBe(true);

    await app.evaluate(async () => {
      const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
      if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
      await seam.requestQuit(0);
    });
    await app.process().waitForEvent('exit');
  } finally {
    await closeApplication(app, dataDirectory);
  }
});
