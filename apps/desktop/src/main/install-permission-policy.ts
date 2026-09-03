import type { Session } from 'electron';

type PermissionPolicySession = Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>;

export function installM0PermissionPolicy(session: PermissionPolicySession): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
