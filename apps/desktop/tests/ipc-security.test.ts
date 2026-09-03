import { describe, expect, it, vi } from 'vitest';
import { buildWindowOptions } from '../src/main/create-window';
import { denyUnexpectedNavigation } from '../src/main/create-window';
import { assertTrustedAppSenderUrl } from '../src/main/ipc-security';
import { getSafeRelativePath } from '../src/main/register-app-protocol';

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

describe('buildWindowOptions', () => {
  it('isolates and sandboxes the renderer', () => {
    const options = buildWindowOptions('/app/preload.js');
    expect(options.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: '/app/preload.js',
    });
  });
});

describe('application origin boundaries', () => {
  it('rejects an application authority with a port', () => {
    expect(getSafeRelativePath('catbots://app:123/index.html')).toBeUndefined();
  });

  it('rejects encoded path traversal', () => {
    expect(getSafeRelativePath('catbots://app/%2e%2e%2fsecret.txt')).toBeUndefined();
  });

  it('denies navigation outside the application origin', () => {
    const event = { preventDefault: vi.fn() };

    denyUnexpectedNavigation(event, 'https://example.com');

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('rejects an IPC sender outside the application entry document', () => {
    expect(() => assertTrustedAppSenderUrl('catbots://app/settings.html')).toThrow('Untrusted IPC sender');
  });
});
