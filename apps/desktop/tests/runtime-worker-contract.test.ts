import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('runtime worker utility-process contract', () => {
  it('uses the utility-process parent port rather than the Electron module export', async () => {
    const source = await readFile(new URL('../src/main/runtime/runtime-worker.ts', import.meta.url), 'utf8');
    expect(source).toContain('process.parentPort?.postMessage');
    expect(source).not.toContain("import { parentPort } from 'electron'");
  });
});
