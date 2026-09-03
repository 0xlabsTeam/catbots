import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { net, protocol } from 'electron';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface AppProtocolOptions {
  rendererDirectory: string;
  developmentServerUrl?: string;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'catbots',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

export function registerAppProtocol(options: AppProtocolOptions): void {
  const rendererRoot = resolve(options.rendererDirectory);

  protocol.handle('catbots', async (request) => {
    const relativePath = getSafeRelativePath(request.url);
    if (!relativePath) {
      return notFound();
    }

    if (options.developmentServerUrl) {
      return net.fetch(new URL(relativePath, options.developmentServerUrl).toString());
    }

    const target = resolve(rendererRoot, relativePath);
    if (!isInside(rendererRoot, target)) {
      return notFound();
    }

    try {
      if (!(await stat(target)).isFile()) {
        return notFound();
      }

      return new Response(await readFile(target), {
        headers: {
          'content-type': contentTypes[extname(target).toLowerCase()] ?? 'application/octet-stream',
        },
      });
    } catch {
      return notFound();
    }
  });
}

function getSafeRelativePath(requestUrl: string): string | undefined {
  let request: URL;
  try {
    request = new URL(requestUrl);
  } catch {
    return undefined;
  }

  if (request.protocol !== 'catbots:' || request.hostname !== 'app') {
    return undefined;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(request.pathname);
  } catch {
    return undefined;
  }

  if (!decodedPath.startsWith('/') || decodedPath.includes('\\')) {
    return undefined;
  }

  const relativePath = normalize(decodedPath.slice(1));
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return undefined;
  }

  return relativePath;
}

function isInside(root: string, candidate: string): boolean {
  return candidate.startsWith(`${root}${sep}`);
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
