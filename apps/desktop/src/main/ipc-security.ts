const applicationEntryUrl = 'catbots://app/index.html';

export class IpcSenderNotAllowedError extends Error {
  readonly code = 'IPC_SENDER_NOT_ALLOWED';

  constructor() {
    super('IPC_SENDER_NOT_ALLOWED: Untrusted IPC sender');
    this.name = 'IpcSenderNotAllowedError';
  }
}

export function assertTrustedAppSenderUrl(senderUrl: string | undefined): void {
  if (senderUrl !== applicationEntryUrl) {
    throw new IpcSenderNotAllowedError();
  }
}
