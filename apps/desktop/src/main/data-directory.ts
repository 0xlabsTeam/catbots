import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export type DataDirectoryOptions = {
  defaultDirectory: string;
  environment: NodeJS.ProcessEnv;
  isProductionSigned: boolean;
};

const invalidTestDirectoryMessage = 'CATBOTS_E2E_DATA_DIR must be an existing resolved absolute directory';

export async function resolveApplicationDataDirectory(options: DataDirectoryOptions): Promise<string> {
  const requested = options.environment.CATBOTS_E2E_DATA_DIR;
  if (options.environment.NODE_ENV !== 'test' || options.isProductionSigned || requested === undefined) {
    return options.defaultDirectory;
  }

  if (!isAbsolute(requested) || resolve(requested) !== requested) throw new Error(invalidTestDirectoryMessage);

  try {
    const status = await lstat(requested);
    const canonicalDirectory = await realpath(requested);
    if (!status.isDirectory() || status.isSymbolicLink() || canonicalDirectory !== requested) {
      throw new Error(invalidTestDirectoryMessage);
    }
    return canonicalDirectory;
  } catch (error) {
    if (error instanceof Error && error.message === invalidTestDirectoryMessage) throw error;
    throw new Error(invalidTestDirectoryMessage);
  }
}

export function isUnsignedE2ETestProcess(environment: NodeJS.ProcessEnv, isProductionSigned: boolean): boolean {
  return environment.NODE_ENV === 'test' && !isProductionSigned && environment.CATBOTS_E2E_DATA_DIR !== undefined;
}
