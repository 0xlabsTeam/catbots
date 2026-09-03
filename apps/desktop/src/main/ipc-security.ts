const applicationEntryUrl = 'catbots://app/index.html';

export function assertTrustedAppSenderUrl(senderUrl: string | undefined): void {
  if (senderUrl !== applicationEntryUrl) {
    throw new Error('Untrusted IPC sender');
  }
}
