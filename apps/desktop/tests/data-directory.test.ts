import { mkdtemp, mkdir, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveApplicationDataDirectory } from '../src/main/data-directory';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'catbots-data-directory-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await (await import('node:fs/promises')).rm(directory, { force: true, recursive: true });
  }));
});

describe('resolveApplicationDataDirectory', () => {
  it('uses a resolved, existing E2E directory only in an unsigned test process', async () => {
    const directory = await createTemporaryDirectory();

    await expect(resolveApplicationDataDirectory({
      defaultDirectory: '/application/user-data',
      environment: { CATBOTS_E2E_DATA_DIR: directory, NODE_ENV: 'test' },
      isProductionSigned: false,
    })).resolves.toBe(directory);
  });

  it('does not honor the E2E override outside an unsigned test process', async () => {
    const directory = await createTemporaryDirectory();

    await expect(resolveApplicationDataDirectory({
      defaultDirectory: '/application/user-data',
      environment: { CATBOTS_E2E_DATA_DIR: directory, NODE_ENV: 'production' },
      isProductionSigned: false,
    })).resolves.toBe('/application/user-data');

    await expect(resolveApplicationDataDirectory({
      defaultDirectory: '/application/user-data',
      environment: { CATBOTS_E2E_DATA_DIR: directory, NODE_ENV: 'test' },
      isProductionSigned: true,
    })).resolves.toBe('/application/user-data');
  });

  it('rejects a relative, missing, or symlinked E2E directory', async () => {
    const directory = await createTemporaryDirectory();
    const link = join(directory, 'linked-data');
    await mkdir(join(directory, 'target'));
    await symlink(join(directory, 'target'), link);

    await expect(resolveApplicationDataDirectory({
      defaultDirectory: '/application/user-data',
      environment: { CATBOTS_E2E_DATA_DIR: 'relative-data', NODE_ENV: 'test' },
      isProductionSigned: false,
    })).rejects.toThrow('CATBOTS_E2E_DATA_DIR must be an existing resolved absolute directory');
    await expect(resolveApplicationDataDirectory({
      defaultDirectory: '/application/user-data',
      environment: { CATBOTS_E2E_DATA_DIR: join(directory, 'missing'), NODE_ENV: 'test' },
      isProductionSigned: false,
    })).rejects.toThrow('CATBOTS_E2E_DATA_DIR must be an existing resolved absolute directory');
    await expect(resolveApplicationDataDirectory({
      defaultDirectory: '/application/user-data',
      environment: { CATBOTS_E2E_DATA_DIR: link, NODE_ENV: 'test' },
      isProductionSigned: false,
    })).rejects.toThrow('CATBOTS_E2E_DATA_DIR must be an existing resolved absolute directory');
  });
});
