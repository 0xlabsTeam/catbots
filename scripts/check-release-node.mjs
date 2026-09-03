import { fileURLToPath } from 'node:url';

export function assertReleaseEnvironment(nodeVersion, platform) {
  const [major] = nodeVersion.split('.').map(Number);
  if (major !== 22) {
    throw new Error(`Catbots packaging requires Node.js 22.x; found ${nodeVersion}. Activate a supported Node 22 installation and retry.`);
  }
  if (platform !== 'darwin') {
    throw new Error(`Catbots M0 release packaging supports macOS only; found ${platform}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertReleaseEnvironment(process.versions.node, process.platform);
}
