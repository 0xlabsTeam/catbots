import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import forgeConfig from '../forge.config';
import { assertReleaseEnvironment } from '../../../scripts/check-release-node.mjs';
import { isForbidden, verifyPackageContents } from '../../../scripts/verify-package-contents.mjs';

const temporaryDirectories: string[] = [];
const rootDirectory = fileURLToPath(new URL('../../../', import.meta.url));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('M0 macOS release boundary', () => {
  it('fails release checks outside Node 22 or macOS', () => {
    expect(() => assertReleaseEnvironment('22.23.2', 'darwin')).not.toThrow();
    expect(() => assertReleaseEnvironment('21.7.3', 'darwin')).toThrow('Node.js 22.x');
    expect(() => assertReleaseEnvironment('22.23.2', 'linux')).toThrow('macOS only');
    expect(() => assertReleaseEnvironment('22.23.2', 'win32')).toThrow('macOS only');
  });

  it('ships explicit Catbots bundle metadata and a dedicated application icon', async () => {
    const packager = forgeConfig.packagerConfig as Record<string, unknown>;
    const maker = forgeConfig.makers?.[0] as { platforms?: string[] } | undefined;
    const appIcon = await readFile(join(rootDirectory, 'apps/desktop/assets/icon.icns'));
    const trayIcon = await readFile(join(rootDirectory, 'apps/desktop/assets/trayTemplate.png'));

    expect(packager).toMatchObject({
      name: 'Catbots',
      executableName: 'Catbots',
      appBundleId: 'com.catbots.desktop',
      appCategoryType: 'public.app-category.finance',
      icon: 'assets/icon.icns',
    });
    expect(maker?.platforms).toEqual(['darwin']);
    expect(appIcon.byteLength).toBeGreaterThan(1_024);
    expect(appIcon.equals(trayIcon)).toBe(false);
  });

  it('states the macOS-only M0 release scope without current-platform claims', async () => {
    const [readme, contributing, rootPackage, desktopPackage] = await Promise.all([
      readFile(join(rootDirectory, 'README.md'), 'utf8'),
      readFile(join(rootDirectory, 'CONTRIBUTING.md'), 'utf8'),
      readFile(join(rootDirectory, 'package.json'), 'utf8'),
      readFile(join(rootDirectory, 'apps/desktop/package.json'), 'utf8'),
    ]);

    expect(readme).toContain('macOS-only');
    expect(contributing).toContain('macOS-only');
    expect(readme).not.toContain('current-platform');
    expect(rootPackage).toContain('Catbots M0 macOS');
    expect(desktopPackage).toContain('Catbots M0 macOS');
  });
});

describe('package content verifier', () => {
  it.each([
    '.local.env.yaml.45da8f7e-ecfb-4be0-aaf4-dc81e7dd3338.tmp',
    '.local.env.yaml.previous.45da8f7e-ecfb-4be0-aaf4-dc81e7dd3338.tmp',
    'local.env.yaml.previous',
  ])('recognizes hidden atomic and rollback config artifact %s', (name) => {
    expect(isForbidden(name)).toBe(true);
  });

  it('keeps the real hidden temporary patterns out of source control', async () => {
    const ignore = await readFile(join(rootDirectory, '.gitignore'), 'utf8');
    expect(ignore).toContain('.local.env.yaml.*.tmp');
    expect(ignore).toContain('local.env.yaml.*.tmp');
  });

  it('rejects a hidden atomic config file anywhere in an artifact tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'catbots-verifier-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'Catbots.app', 'Contents', 'Resources'), { recursive: true });
    await writeFile(join(directory, 'Catbots.app', 'Contents', 'Resources', '.local.env.yaml.previous.fixture.tmp'), 'secret');

    await expect(verifyPackageContents(directory)).rejects.toThrow('.local.env.yaml.previous.fixture.tmp');
  });
});
