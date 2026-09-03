import { mkdtemp, mkdir, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectMacSignature, isUnsignedDevelopmentBuild, isUnsignedE2ETestProcess, resolveApplicationDataDirectory } from '../src/main/data-directory';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'catbots-e2e-'));
  temporaryDirectories.push(directory);
  return directory;
}

function options(directory: string, overrides: Partial<Parameters<typeof resolveApplicationDataDirectory>[0]> = {}) {
  return {
    allowE2EDataDirectory: true,
    defaultDirectory: '/application/user-data',
    environment: { CATBOTS_E2E_DATA_DIR: directory, NODE_ENV: 'test' },
    protectedDirectories: [],
    temporaryRoot: tmpdir(),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await (await import('node:fs/promises')).rm(directory, { force: true, recursive: true });
  }));
});

describe('resolveApplicationDataDirectory', () => {
  it('uses only a canonical dedicated E2E child below the real OS temporary root', async () => {
    const directory = await createTemporaryDirectory();
    await expect(resolveApplicationDataDirectory(options(directory))).resolves.toBe(directory);
  });

  it('does not honor the override unless the centralized test/build guard allows it', async () => {
    const directory = await createTemporaryDirectory();
    await expect(resolveApplicationDataDirectory(options(directory, { allowE2EDataDirectory: false }))).resolves.toBe('/application/user-data');
  });

  it('rejects a relative, missing, symlinked, nested, or non-Catbots temporary directory', async () => {
    const directory = await createTemporaryDirectory();
    const link = join(directory, 'linked-data');
    await mkdir(join(directory, 'target'));
    await symlink(join(directory, 'target'), link);
    const nonDedicated = await mkdtemp(join(await realpath(tmpdir()), 'another-app-'));
    temporaryDirectories.push(nonDedicated);

    await expect(resolveApplicationDataDirectory(options('relative-data'))).rejects.toThrow('canonical dedicated child');
    await expect(resolveApplicationDataDirectory(options(join(directory, 'missing')))).rejects.toThrow('canonical dedicated child');
    await expect(resolveApplicationDataDirectory(options(link))).rejects.toThrow('canonical dedicated child');
    await expect(resolveApplicationDataDirectory(options(nonDedicated))).rejects.toThrow('canonical dedicated child');
  });

  it('rejects a weak/static suffix and protected directory symlink aliases', async () => {
    const root = await createTemporaryDirectory();
    const weakDirectory = join(root, 'catbots-e2e-fixed');
    await mkdir(weakDirectory);
    await expect(resolveApplicationDataDirectory(options(weakDirectory, { temporaryRoot: root }))).rejects.toThrow('canonical dedicated child');

    const directory = await createTemporaryDirectory();
    const protectedTarget = join(root, 'protected');
    const protectedAlias = join(root, 'protected-alias');
    await mkdir(protectedTarget);
    await symlink(protectedTarget, protectedAlias);
    await expect(resolveApplicationDataDirectory(options(directory, { protectedDirectories: [protectedAlias] }))).rejects.toThrow('canonical dedicated child');
  });
});

describe('unsigned E2E build guard', () => {
  it('uses the absolute macOS signer path even when PATH could provide a fake codesign', () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const signature = inspectMacSignature('/fake/executable', (command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return { status: 0, stderr: 'Signature=adhoc\nTeamIdentifier=not set', stdout: '' };
    });
    expect(signature).toContain('Signature=adhoc');
    expect(calls).toEqual([{ command: '/usr/bin/codesign', args: ['-dv', '--verbose=4', '/fake/executable'] }]);
  });

  it('accepts development default-app processes and macOS ad-hoc packaged builds only', () => {
    expect(isUnsignedDevelopmentBuild({ executablePath: '/app', isDefaultApp: true, isMacAppStore: false, isPackaged: false, platform: 'darwin' })).toBe(true);
    expect(isUnsignedDevelopmentBuild({
      executablePath: '/app',
      isDefaultApp: false,
      isMacAppStore: false,
      isPackaged: true,
      platform: 'darwin',
      inspectMacSignature: () => 'Signature=adhoc\nTeamIdentifier=not set',
    })).toBe(true);
  });

  it('rejects a production signature, MAS build, and unproven packaged build', () => {
    const signed = 'Authority=Developer ID Application\nTeamIdentifier=TEAM';
    expect(isUnsignedDevelopmentBuild({ executablePath: '/app', isDefaultApp: false, isMacAppStore: false, isPackaged: true, platform: 'darwin', inspectMacSignature: () => signed })).toBe(false);
    expect(isUnsignedDevelopmentBuild({ executablePath: '/app', isDefaultApp: false, isMacAppStore: true, isPackaged: true, platform: 'darwin', inspectMacSignature: () => 'Signature=adhoc\nTeamIdentifier=not set' })).toBe(false);
    expect(isUnsignedDevelopmentBuild({ executablePath: '/app', isDefaultApp: false, isMacAppStore: false, isPackaged: true, platform: 'linux' })).toBe(false);
  });

  it('requires NODE_ENV=test, the isolated data-dir variable, and positive unsigned state', () => {
    expect(isUnsignedE2ETestProcess({ NODE_ENV: 'test', CATBOTS_E2E_DATA_DIR: '/tmp/catbots-e2e-id' }, true)).toBe(true);
    expect(isUnsignedE2ETestProcess({ NODE_ENV: 'production', CATBOTS_E2E_DATA_DIR: '/tmp/catbots-e2e-id' }, true)).toBe(false);
    expect(isUnsignedE2ETestProcess({ NODE_ENV: 'test' }, true)).toBe(false);
    expect(isUnsignedE2ETestProcess({ NODE_ENV: 'test', CATBOTS_E2E_DATA_DIR: '/tmp/catbots-e2e-id' }, false)).toBe(false);
  });
});
