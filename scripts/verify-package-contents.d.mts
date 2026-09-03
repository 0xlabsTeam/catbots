export function isForbidden(path: string): boolean;
export function findForbiddenEntries(directory: string, displayRoot: string): Promise<string[]>;
export function verifyPackageContents(artifactDirectory: string): Promise<void>;
