import { describe, expect, it, vi } from 'vitest';
import { installM0PermissionPolicy } from '../src/main/install-permission-policy';
import { rendererContentSecurityPolicy } from '../vite.renderer.config';

describe('M0 session permissions', () => {
  it('denies every permission request and permission check', () => {
    let requestHandler: ((webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | undefined;
    let checkHandler: ((webContents: unknown, permission: string) => boolean) | undefined;
    const session = {
      setPermissionRequestHandler: vi.fn((handler) => { requestHandler = handler; }),
      setPermissionCheckHandler: vi.fn((handler) => { checkHandler = handler; }),
    };
    installM0PermissionPolicy(session);
    const decision = vi.fn();

    requestHandler?.({}, 'notifications', decision);

    expect(decision).toHaveBeenCalledExactlyOnceWith(false);
    expect(checkHandler?.({}, 'media')).toBe(false);
    expect(checkHandler?.({}, 'clipboard-read')).toBe(false);
  });
});

describe('renderer Content Security Policy', () => {
  it('allows renderer connections only to self in production', () => {
    const policy = rendererContentSecurityPolicy(false);

    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain('localhost');
    expect(policy).not.toContain('ws:');
  });

  it('adds only Vite loopback HTTP and WebSocket connections during development', () => {
    const policy = rendererContentSecurityPolicy(true);

    expect(policy).toContain("connect-src 'self' http://localhost:* ws://localhost:*");
  });
});
