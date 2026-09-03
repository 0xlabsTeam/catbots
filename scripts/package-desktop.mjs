import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, 'apps/desktop');
const [major] = process.versions.node.split('.').map(Number);
if (major !== 22) throw new Error(`Catbots packaging requires Node.js 22.x; found ${process.versions.node}.`);

export function createRunner(spawnCommand = spawn) {
  return function run(command, args, cwd = desktop) {
  return new Promise((resolveRun, reject) => {
    const child = spawnCommand(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${signal ?? code})`)));
  });
  };
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

export function createSignalController({ on, off, exit, terminate, restoreHost }) {
  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    await restoreHost();
  };
  const handle = (signal) => async () => {
    terminate(signal);
    await restore();
    off('SIGINT', handlers.SIGINT);
    off('SIGTERM', handlers.SIGTERM);
    exit(signal === 'SIGINT' ? 130 : 143);
  };
  const handlers = { SIGINT: handle('SIGINT'), SIGTERM: handle('SIGTERM') };
  on('SIGINT', handlers.SIGINT);
  on('SIGTERM', handlers.SIGTERM);
  return { dispose: async () => { await restore(); off('SIGINT', handlers.SIGINT); off('SIGTERM', handlers.SIGTERM); } };
}

const run = createRunner();

const nativePath = resolve(root, 'node_modules/better-sqlite3');
async function restoreHost() {
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'install', '--prefix', nativePath], root);
}

async function main() {
try {
  await runPackaging({
    rebuildElectron: () => run(resolve(root, 'node_modules/.bin/electron-rebuild'), ['-f', '-w', 'better-sqlite3']),
    forge: () => run(resolve(root, 'node_modules/.bin/electron-forge'), [process.argv[2] ?? 'package']),
    restoreHost,
  });
} finally {}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
