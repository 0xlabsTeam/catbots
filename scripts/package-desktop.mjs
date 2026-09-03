import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, 'apps/desktop');
const [major] = process.versions.node.split('.').map(Number);
if (major !== 22) throw new Error(`Catbots packaging requires Node.js 22.x; found ${process.versions.node}.`);

export function createRunner(spawnCommand = spawn) {
  return function run(command, args, cwd = desktop, onSpawn) {
  return new Promise((resolveRun, reject) => {
    const child = spawnCommand(command, args, { cwd, env: process.env, stdio: 'inherit' });
    onSpawn?.(child);
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${signal ?? code})`)));
  });
  };
}

export function waitForChildExit(child) {
  return new Promise((resolveExit) => child.once('exit', resolveExit));
}

export async function runPackaging({ rebuildElectron, forge, restoreHost }) {
  let primary;
  try {
    await rebuildElectron();
    await forge();
  } catch (error) {
    primary = error;
  }
  try {
    await restoreHost();
  } catch (restoreError) {
    if (primary !== undefined) throw new Error('Catbots packaging and host ABI restoration failed');
    throw restoreError;
  }
  if (primary !== undefined) throw primary;
}

export function createSignalController({ on, off, exit, terminate, waitForExit, restoreHost, report = () => undefined }) {
  let restored = false;
  let handling = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    await restoreHost();
  };
  const handle = (signal) => async () => {
    if (handling) return;
    handling = true;
    const childExit = waitForExit();
    terminate(signal);
    try {
      await childExit;
      await restore();
      exit(signal === 'SIGINT' ? 130 : 143);
    } catch {
      report('Catbots host ABI restoration failed after interruption.');
      exit(1);
    } finally {
      off('SIGINT', handlers.SIGINT);
      off('SIGTERM', handlers.SIGTERM);
    }
  };
  const handlers = { SIGINT: handle('SIGINT'), SIGTERM: handle('SIGTERM') };
  on('SIGINT', handlers.SIGINT);
  on('SIGTERM', handlers.SIGTERM);
  return { remove: () => { off('SIGINT', handlers.SIGINT); off('SIGTERM', handlers.SIGTERM); } };
}

export async function runForgeWithSignalHandling({ runCommand, command, args, on, off, exit, restoreHost, report }) {
  let controller;
  try {
    await runCommand(command, args, desktop, (child) => {
      controller = createSignalController({
        on,
        off,
        exit,
        terminate: (signal) => child.kill(signal),
        waitForExit: () => waitForChildExit(child),
        restoreHost,
        report,
      });
    });
  } finally {
    controller?.remove();
  }
}

const run = createRunner();

const nativePath = resolve(root, 'node_modules/better-sqlite3');
async function restoreHost() {
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'install', '--prefix', nativePath], root);
}

async function main() {
  let restored = false;
  const restoreOnce = async () => {
    if (restored) return;
    restored = true;
    await restoreHost();
  };
  await runPackaging({
    rebuildElectron: () => run(resolve(root, 'node_modules/.bin/electron-rebuild'), ['-f', '-w', 'better-sqlite3']),
    forge: () => runForgeWithSignalHandling({
      runCommand: run,
      command: resolve(root, 'node_modules/.bin/electron-forge'),
      args: [process.argv[2] ?? 'package'],
      on: process.on.bind(process),
      off: process.off.bind(process),
      exit: (code) => process.exit(code),
      restoreHost: restoreOnce,
      report: (message) => console.error(message),
    }),
    restoreHost: restoreOnce,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
