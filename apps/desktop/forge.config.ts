import { cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

const workspaceNodeModules = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'node_modules');
const sqliteRuntimeDependencies = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

async function stageSqliteRuntimeDependencies(
  _forgeConfig: ForgeConfig,
  buildPath: string,
): Promise<void> {
  await Promise.all(sqliteRuntimeDependencies.map((dependency) => cp(
    join(workspaceNodeModules, dependency),
    join(buildPath, 'node_modules', dependency),
    { dereference: true, recursive: true },
  )));
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  hooks: {
    packageAfterCopy: stageSqliteRuntimeDependencies,
  },
  makers: [new MakerZIP({}, ['darwin'])],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
