import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const artifactDirectory = process.argv[2];
if (artifactDirectory === undefined) throw new Error('Usage: verify-package-contents.mjs <artifact-directory>');

const forbidden = new Set(['local.env.yaml', 'local.env.yaml.previous', '.superpowers']);

async function findForbiddenEntries(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const findings = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (forbidden.has(entry.name)) findings.push(relative(artifactDirectory, path));
    if (entry.isDirectory()) findings.push(...await findForbiddenEntries(path));
  }
  return findings;
}

const findings = await findForbiddenEntries(artifactDirectory);
if (findings.length > 0) throw new Error(`Forbidden packaged files: ${findings.join(', ')}`);
