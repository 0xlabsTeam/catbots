import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { cleanupApplication } from './cleanup';

type LifecycleTestSeam = {
  openMainWindow(): Promise<void>;
  requestQuit(response: number): Promise<void>;
};

type RunningApplication = {
  app: ElectronApplication;
  logs: string[];
  process: ChildProcess;
};

type FakeProvider = {
  baseUrl: string;
  requests: Array<{ authorization?: string; path?: string; xApiKey?: string }>;
  server: Server;
};

async function findPackagedExecutable(directory: string): Promise<string> {
  const executable = join(directory, `Catbots-darwin-${process.arch}`, 'Catbots.app', 'Contents', 'MacOS', 'Catbots');
  try {
    await access(executable);
  } catch {
    throw new Error(`Expected the Catbots macOS ${process.arch} packaged executable`);
  }
  return executable;
}

async function launchApplication(dataDirectory: string): Promise<RunningApplication> {
  const app = await electron.launch({
    executablePath: await findPackagedExecutable(resolve('apps/desktop/out')),
    args: [],
    env: { ...process.env, CATBOTS_E2E_DATA_DIR: dataDirectory, NODE_ENV: 'test' },
  });
  const child = app.process();
  const logs: string[] = [];
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));
  return { app, logs, process: child };
}

async function launchFreshApplication(): Promise<RunningApplication & { dataDirectory: string }> {
  const dataDirectory = await mkdtemp(join(await realpath(tmpdir()), 'catbots-e2e-'));
  try {
    return { ...await launchApplication(dataDirectory), dataDirectory };
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

async function requestConfirmedQuit(running: RunningApplication): Promise<void> {
  const exit = waitForExit(running.process);
  const request = running.app.evaluate(async () => {
    const seam = (globalThis as typeof globalThis & { __catbotsE2E?: LifecycleTestSeam }).__catbotsE2E;
    if (seam === undefined) throw new Error('E2E lifecycle seam unavailable');
    await seam.requestQuit(0);
  });
  const exited = await waitForExitWithin(running.process, 10_000);
  await request.catch((error: unknown) => {
    if (!exited) throw error;
  });
  await exit;
  expect(exited).toBe(true);
  expect(running.process.signalCode).toBeNull();
  expect(running.process.exitCode).toBe(0);
}

async function waitForRuntimeReady(app: ElectronApplication): Promise<void> {
  const page = await app.firstWindow();
  await expect.poll(
    () => page.evaluate(async () => (await window.catbots.runtime.getStatus()).state),
    { timeout: 10_000 },
  ).toBe('ready');
}

async function startOpenAiProvider(secret: string): Promise<FakeProvider> {
  const requests: FakeProvider['requests'] = [];
  const server = createServer((request, response) => {
    requests.push({
      authorization: request.headers.authorization,
      path: request.url,
      xApiKey: request.headers['x-api-key'] as string | undefined,
    });
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Fake provider did not bind a TCP port');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, server };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose, reject) => server.close((error) => error === undefined ? resolveClose() : reject(error)));
}

test('fresh install reaches local-profile onboarding', async () => {
  let app: ElectronApplication | undefined;
  let process: ChildProcess | undefined;
  let dataDirectory: string | undefined;
  try {
    ({ app, dataDirectory, process } = await launchFreshApplication());
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Connect your AI provider' })).toBeVisible();
  } finally {
    await closeApplication(app, process, dataDirectory);
  }
});

test('packaged local workflow persists tested settings and a Draft Bot across restarts', async () => {
  test.setTimeout(120_000);
  const secret = 'e2e-provider-secret-sentinel';
  const provider = await startOpenAiProvider(secret);
  const dataDirectory = await mkdtemp(join(await realpath(tmpdir()), 'catbots-e2e-'));
  const logBuffers: string[][] = [];
  let running: RunningApplication | undefined;
  try {
    running = await launchApplication(dataDirectory);
    logBuffers.push(running.logs);
    const onboarding = await running.app.firstWindow();
    await expect(onboarding.getByRole('heading', { name: 'Connect your AI provider' })).toBeVisible();
    await waitForRuntimeReady(running.app);

    const csp = await onboarding.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('localhost');
    expect(csp).not.toContain('ws:');

    const profileInput = onboarding.getByLabel('Profile name');
    const submit = onboarding.getByRole('button', { name: 'Connect & continue' });
    const styles = await onboarding.evaluate(() => {
      const primary = document.querySelector<HTMLButtonElement>('button[type="submit"]');
      const input = document.querySelector<HTMLInputElement>('#profile-name');
      const card = document.querySelector<HTMLElement>('.settings-card');
      return {
        cardBackground: card === null ? undefined : getComputedStyle(card).backgroundColor,
        cardUsesKumoSurface: card?.classList.contains('bg-kumo-base') ?? false,
        inputHeight: input === null ? 0 : input.getBoundingClientRect().height,
        inputUsesKumoControl: input?.classList.contains('bg-kumo-control') ?? false,
        primaryThemeBackground: primary === null ? '' : getComputedStyle(primary).getPropertyValue('--kumo-button-emphasis-bg'),
      };
    });
    expect(styles.inputHeight).toBe(36);
    expect(styles.cardBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.cardUsesKumoSurface).toBe(true);
    expect(styles.inputUsesKumoControl).toBe(true);
    expect(styles.primaryThemeBackground).not.toBe('');

    const keyHelpTrigger = onboarding.getByRole('button', { name: 'How is my key handled?' });
    await keyHelpTrigger.click();
    const keyHelp = onboarding.getByRole('dialog', { name: 'Local-only credentials' });
    await expect(keyHelp).toBeVisible();
    const dialogStyle = await keyHelp.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, padding: style.paddingTop, position: style.position };
    });
    expect(dialogStyle.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(Number.parseFloat(dialogStyle.padding)).toBeGreaterThan(0);
    expect(dialogStyle.position).toBe('fixed');
    const closeDialog = keyHelp.getByRole('button', { name: 'Close' });
    await expect(closeDialog).toBeFocused();
    await closeDialog.click();
    await expect(keyHelpTrigger).toBeFocused();

    await profileInput.fill('E2E Local Profile');
    await onboarding.getByLabel('Base URL').fill(provider.baseUrl);
    await onboarding.getByLabel('API key').fill(secret);
    await onboarding.getByLabel('Model').fill('e2e-fixture-model');
    await submit.click();
    await expect.poll(() => provider.requests.length).toBe(1);
    expect(provider.requests[0]).toEqual({
      authorization: `Bearer ${secret}`,
      path: '/v1/chat/completions',
      xApiKey: undefined,
    });
    await expect(onboarding.getByRole('heading', { name: 'Bots', exact: true })).toBeVisible();
    await requestConfirmedQuit(running);
    running = undefined;

    running = await launchApplication(dataDirectory);
    logBuffers.push(running.logs);
    const restored = await running.app.firstWindow();
    await expect(restored.getByRole('heading', { name: 'Bots', exact: true })).toBeVisible();
    await waitForRuntimeReady(running.app);
    await restored.getByRole('button', { name: 'Settings' }).click();
    await expect(restored.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(restored.getByLabel('Profile name')).toHaveValue('E2E Local Profile');
    await expect(restored.getByLabel('API key')).toHaveValue('');
    await expect(restored.getByText('Stored key: ••••••••')).toBeVisible();
    await restored.getByLabel('Base URL').fill(`${provider.baseUrl}/tenant`);
    await expect(restored.getByText('The stored key cannot be reused for a different provider location. Enter a new API key to test and save.')).toBeVisible();
    await expect(restored.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    await expect(restored.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    expect(provider.requests).toHaveLength(1);
    await restored.getByLabel('Base URL').fill(`${provider.baseUrl}/`);
    await expect(restored.getByRole('button', { name: 'Test connection' })).toBeEnabled();
    await restored.getByLabel('Profile name').fill('E2E Renamed Profile');
    await restored.getByRole('button', { name: 'Test connection' }).click();
    await expect(restored.getByText('Connection successful')).toBeVisible();
    await restored.getByRole('button', { name: 'Save settings' }).click();
    await expect(restored.getByText('Settings saved')).toBeVisible();
    await expect.poll(() => provider.requests.length).toBe(2);
    expect(provider.requests[1]?.authorization).toBe(`Bearer ${secret}`);

    await restored.getByRole('button', { name: 'Bots' }).click();
    await restored.getByRole('button', { name: 'Create new bot' }).first().click();
    await restored.getByLabel('Bot name').fill('E2E Dynamic Draft');
    await expect(restored.getByRole('combobox', { name: 'DEX' })).toContainText('Hyperliquid');
    await expect(restored.getByLabel('Market')).toHaveCount(0);
    await restored.getByRole('button', { name: 'Create draft' }).click();
    await expect(restored.getByRole('heading', { name: 'E2E Dynamic Draft' })).toBeVisible();
    await expect(restored.getByText('Hyperliquid · Dynamic markets')).toBeVisible();
    await expect(restored.getByText('Draft', { exact: true })).toBeVisible();
    await requestConfirmedQuit(running);
    running = undefined;

    running = await launchApplication(dataDirectory);
    logBuffers.push(running.logs);
    const persisted = await running.app.firstWindow();
    await waitForRuntimeReady(running.app);
    await expect(persisted.getByText('E2E Dynamic Draft')).toBeVisible();
    await expect(persisted.getByText('Hyperliquid')).toBeVisible();
    await expect(persisted.getByText('BTC-PERP')).toHaveCount(0);
    await persisted.getByRole('button', { name: 'Settings' }).click();
    await expect(persisted.getByLabel('Profile name')).toHaveValue('E2E Renamed Profile');
    await expect(persisted.getByLabel('API key')).toHaveValue('');
    await expect(persisted.getByText('Stored key: ••••••••')).toBeVisible();
    await requestConfirmedQuit(running);
    running = undefined;

    expect(logBuffers.flat().join('')).not.toContain(secret);
  } finally {
    await closeApplication(running?.app, running?.process, dataDirectory);
    await closeServer(provider.server);
    expect(logBuffers.flat().join('')).not.toContain(secret);
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
    await expect(reopened.getByRole('heading', { name: 'Connect your AI provider' })).toBeVisible();

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
