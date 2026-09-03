import { spawnSync } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

export type DataDirectoryOptions = {
  allowE2EDataDirectory: boolean;
  defaultDirectory: string;
  environment: NodeJS.ProcessEnv;
  protectedDirectories: readonly string[];
  temporaryRoot: string;
};

export type UnsignedBuildOptions = {
  executablePath: string;
  isDefaultApp: boolean;
  isMacAppStore: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  inspectMacSignature?: (executablePath: string) => string | undefined;
};

const invalidTestDirectoryMessage = 'CATBOTS_E2E_DATA_DIR must be a canonical dedicated child of the OS temporary directory';
const e2eDirectoryPrefix = 'catbots-e2e-';

export function inspectMacSignature(executablePath: string): string | undefined {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', executablePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error !== undefined || result.status !== 0) return undefined;
  return `${result.stdout}${result.stderr}`;
}

export function isUnsignedDevelopmentBuild(options: UnsignedBuildOptions): boolean {
  if (options.isDefaultApp) return true;
  if (options.platform !== 'darwin' || !options.isPackaged || options.isMacAppStore) return false;

  const signature = (options.inspectMacSignature ?? inspectMacSignature)(options.executablePath);
  return signature !== undefined
    && signature.includes('Signature=adhoc')
    && signature.includes('TeamIdentifier=not set')
    && !signature.includes('Authority=');
}

export function isUnsignedE2ETestProcess(environment: NodeJS.ProcessEnv, isUnsignedBuild: boolean): boolean {
  return environment.NODE_ENV === 'test'
    && environment.CATBOTS_E2E_DATA_DIR !== undefined
    && isUnsignedBuild;
}

function isInside(directory: string, parent: string): boolean {
  const path = relative(parent, directory);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function ensureNotSymlink(directory: string): Promise<void> {
  const status = await lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(invalidTestDirectoryMessage);
}

export async function resolveApplicationDataDirectory(options: DataDirectoryOptions): Promise<string> {
  const requested = options.environment.CATBOTS_E2E_DATA_DIR;
  if (!options.allowE2EDataDirectory || requested === undefined) return options.defaultDirectory;
  if (!isAbsolute(requested) || resolve(requested) !== requested) throw new Error(invalidTestDirectoryMessage);

  try {
    const canonicalRoot = await realpath(options.temporaryRoot);
    const canonicalDirectory = await realpath(requested);
    if (canonicalDirectory !== requested || dirname(canonicalDirectory) !== canonicalRoot || !basename(canonicalDirectory).startsWith(e2eDirectoryPrefix)) {
      throw new Error(invalidTestDirectoryMessage);
    }
    await ensureNotSymlink(canonicalRoot);
    await ensureNotSymlink(canonicalDirectory);
    for (const protectedDirectory of options.protectedDirectories) {
      if (isInside(canonicalDirectory, resolve(protectedDirectory)) || isInside(resolve(protectedDirectory), canonicalDirectory)) {
        throw new Error(invalidTestDirectoryMessage);
      }
    }
    return canonicalDirectory;
  } catch (error) {
    if (error instanceof Error && error.message === invalidTestDirectoryMessage) throw error;
    throw new Error(invalidTestDirectoryMessage);
  }
}
