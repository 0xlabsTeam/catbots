import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, 'apps/desktop');
const [major] = process.versions.node.split('.').map(Number);
if (major !== 22) throw new Error(`Catbots packaging requires Node.js 22.x; found ${process.versions.node}.`);

function run(command, args, cwd = desktop) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${signal ?? code})`)));
  });
}

const nativePath = resolve(root, 'node_modules/better-sqlite3');
async function restoreHost() {
  await run(process.execPath, ['run', 'install', '--prefix', nativePath], root);
}

try {
  await run(resolve(root, 'node_modules/.bin/electron-rebuild'), ['-f', '-w', 'better-sqlite3']);
  await run(resolve(root, 'node_modules/.bin/electron-forge'), [process.argv[2] ?? 'package']);
} finally {
  await restoreHost();
}
