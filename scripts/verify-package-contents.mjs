import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { listPackage } from '@electron/asar';

const execute = promisify(execFile);
const artifactDirectory = process.argv[2];
if (artifactDirectory === undefined) throw new Error('Usage: verify-package-contents.mjs <artifact-directory>');

function isForbidden(path) {
  const names = path.split(/[\\/]/);
  return names.some((name) => name === '.superpowers'
    || name === 'local.env.yaml'
    || name.startsWith('local.env.yaml.')
    || /^review(?:[-_.]|$)/i.test(name)
    || /^visual(?:[-_.]|$)/i.test(name));
}

async function findForbiddenEntries(directory, displayRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const findings = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const displayPath = relative(displayRoot, path);
    if (isForbidden(displayPath)) findings.push(displayPath);
    if (entry.isDirectory()) {
      findings.push(...await findForbiddenEntries(path, displayRoot));
    } else if (entry.isFile() && entry.name.endsWith('.asar')) {
      findings.push(...listPackage(path, { isPack: false })
        .filter((archivePath) => isForbidden(archivePath))
        .map((archivePath) => `${displayPath}:${archivePath}`));
    } else if (entry.isFile() && entry.name.endsWith('.zip')) {
      findings.push(...await inspectZip(path, displayRoot));
    }
  }
  return findings;
}

async function inspectZip(zipPath, displayRoot) {
  const inspectionDirectory = await mkdtemp(join(tmpdir(), 'catbots-package-inspect-'));
  try {
    await execute('unzip', ['-qq', '-o', zipPath, '-d', inspectionDirectory]);
    const findings = await findForbiddenEntries(inspectionDirectory, inspectionDirectory);
    return findings.map((finding) => `${relative(displayRoot, zipPath)}:${finding}`);
  } finally {
    await rm(inspectionDirectory, { force: true, recursive: true });
  }
}

const findings = await findForbiddenEntries(artifactDirectory, artifactDirectory);
if (findings.length > 0) throw new Error(`Forbidden packaged files: ${findings.join(', ')}`);
